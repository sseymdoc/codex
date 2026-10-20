// Codex UI's native browser executor, using Electron's debugger transport and public CDP APIs.
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

const LIMIT = 500,
  MAX_TEXT = 4000,
  MAX_BODY = 2 * 1024 * 1024;
const shorten = (value) => String(value ?? "").slice(0, MAX_TEXT);
const remoteText = (value) =>
  shorten(
    value.value === undefined
      ? (value.unserializableValue ?? value.description ?? value.type)
      : typeof value.value === "string"
        ? value.value
        : JSON.stringify(value.value),
  );

// Serialized into the page; searches ordinary DOM and open shadow roots without page-installed helpers.
function findElement(selector) {
  const roots = [document];
  for (let index = 0; index < roots.length && index < 100; index++) {
    const root = roots[index],
      found = root.querySelector(selector);
    if (found) return found;
    for (const node of root.querySelectorAll("*")) if (node.shadowRoot && roots.length < 100) roots.push(node.shadowRoot);
  }
  return null;
}

function describeElement(properties) {
  const rect = this.getBoundingClientRect(),
    computed = getComputedStyle(this),
    styles = {};
  for (const key of properties) styles[key] = computed.getPropertyValue(key);
  const components = [];
  const key = Object.keys(this).find((key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$"));
  let fiber = key && this[key];
  for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
    const type = fiber.type,
      name = typeof type === "function" ? type.displayName || type.name : type?.displayName;
    if (name && !components.includes(name)) components.push(String(name).slice(0, 120));
  }
  return {
    tagName: this.tagName,
    html: this.outerHTML.slice(0, 16000),
    text: (this.textContent ?? "").slice(0, 8000),
    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    styles,
    react: components.length ? { components } : null,
  };
}

export class BrowserCDP {
  #wc;
  #attached = false;
  #attaching;
  #budget = new AsyncLocalStorage();
  #pending = new Set();
  #runs = new Set();
  #console = [];
  #network = new Map();
  #group = 0;
  #guard;
  #selection;
  #pressed = false;
  #message = (_event, method, params) => {
    void this.#onMessage(method, params).catch(() => {});
  };
  #detached = () => {
    this.#attached = false;
    this.#selection = undefined;
    for (const fail of this.#pending) fail(new Error("Browser debugger detached"));
  };

  isAttached() {
    return this.#attached && !this.#wc?.isDestroyed() && this.#wc.debugger.isAttached();
  }
  async attach(wc) {
    if (this.isAttached() && this.#wc === wc) return;
    if (this.#attaching) return this.#attaching;
    this.#attaching = this.#attach(wc);
    try {
      await this.#attaching;
    } finally {
      this.#attaching = undefined;
    }
  }
  async #attach(wc) {
    if (this.#wc && this.#wc !== wc) await this.detach();
    this.#wc = wc;
    wc.debugger.removeListener("message", this.#message);
    wc.debugger.removeListener("detach", this.#detached);
    if (wc.debugger.isAttached()) throw new Error("Browser debugger is in use by another client");
    wc.debugger.attach("1.3");
    this.#attached = true;
    wc.debugger.on("message", this.#message);
    wc.debugger.on("detach", this.#detached);
    try {
      for (const domain of ["Page", "Runtime", "DOM", "Accessibility", "Overlay"]) await this.sendCommand(domain + ".enable");
      await this.sendCommand("Network.enable", { maxTotalBufferSize: 8 * MAX_BODY, maxResourceBufferSize: MAX_BODY, maxPostDataSize: 0 });
    } catch (error) {
      await this.detach();
      throw error;
    }
  }
  async detach() {
    const wc = this.#wc;
    if (wc && !wc.isDestroyed()) {
      this.#releasePointer();
      wc.debugger.removeListener("message", this.#message);
      wc.debugger.removeListener("detach", this.#detached);
      if (this.#attached && wc.debugger.isAttached()) wc.debugger.detach();
    }
    this.#detached();
    this.#wc = undefined;
    this.#console = [];
    this.#network.clear();
  }
  #check() {
    const budget = this.#budget.getStore();
    if (budget && (budget.expired || performance.now() >= budget.deadline)) throw new Error("Browser operation timed out");
    if (!this.isAttached()) throw new Error("Browser debugger is not attached");
  }
  cancel() {
    for (const budget of this.#runs) {
      budget.expired = true;
      budget.reject(new Error("Browser call cancelled"));
    }
    this.#interrupt();
    for (const fail of this.#pending) fail(new Error("Browser call cancelled"));
  }
  #interrupt() {
    if (this.isAttached()) {
      void this.#wc.debugger.sendCommand("Runtime.terminateExecution").catch(() => {});
      this.#releasePointer();
    }
  }
  #releasePointer() {
    if (this.#pressed && this.isAttached()) {
      this.#pressed = false;
      void this.#wc.debugger
        .sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x: 0, y: 0, button: "left", buttons: 0, clickCount: 1 })
        .catch(() => {});
    }
  }
  async run(timeout, action) {
    if (!Number.isFinite(timeout) || timeout < 1) throw new Error("Invalid browser timeout");
    const budget = { deadline: performance.now() + timeout, expired: false };
    return this.#budget.run(budget, async () => {
      let timer;
      try {
        return await Promise.race([
          Promise.resolve().then(action),
          new Promise((_, reject) => {
            budget.reject = reject;
            this.#runs.add(budget);
            timer = setTimeout(() => {
              budget.expired = true;
              this.#interrupt();
              reject(new Error("Browser operation timed out"));
            }, timeout);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        this.#runs.delete(budget);
        this.#releasePointer();
      }
    });
  }
  async sendCommand(method, params = {}) {
    this.#check();
    const remaining = Math.max(1, Math.min(10000, (this.#budget.getStore()?.deadline ?? Infinity) - performance.now()));
    let timer, fail;
    try {
      const result = await new Promise((resolve, reject) => {
        fail = reject;
        this.#pending.add(fail);
        timer = setTimeout(() => {
          if (method.startsWith("Runtime.")) this.#interrupt();
          reject(new Error(`Browser command timed out: ${method}`));
        }, remaining);
        Promise.resolve()
          .then(() => this.#wc.debugger.sendCommand(method, params))
          .then(resolve, reject);
      });
      this.#check();
      return result;
    } finally {
      clearTimeout(timer);
      this.#pending.delete(fail);
    }
  }
  async #onMessage(method, p) {
    if (method === "Runtime.consoleAPICalled") {
      this.#console.push({
        level: p.type === "warning" ? "warn" : p.type,
        text: p.args.map(remoteText).join(" ").slice(0, MAX_TEXT),
        timestamp: p.timestamp,
      });
    } else if (method === "Runtime.exceptionThrown") {
      this.#console.push({
        level: "error",
        text: shorten(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text),
        timestamp: p.timestamp,
      });
    } else if (method === "Network.requestWillBeSent") {
      this.#network.delete(p.requestId);
      this.#network.set(p.requestId, {
        requestId: p.requestId,
        url: shorten(p.request.url),
        method: p.request.method,
        type: p.type,
        timestamp: p.timestamp,
      });
      while (this.#network.size > LIMIT) this.#network.delete(this.#network.keys().next().value);
    } else if (method === "Network.responseReceived") {
      const entry = this.#network.get(p.requestId);
      if (entry) Object.assign(entry, { status: p.response.status, mimeType: p.response.mimeType });
    } else if (method === "Network.loadingFinished") {
      const entry = this.#network.get(p.requestId);
      if (entry) Object.assign(entry, { finished: true, size: p.encodedDataLength });
    } else if (method === "Network.loadingFailed") {
      const entry = this.#network.get(p.requestId);
      if (entry) Object.assign(entry, { finished: true, error: shorten(p.errorText) });
    } else if (method === "Overlay.inspectNodeRequested" && this.#selection) {
      const { callback, onError } = this.#selection;
      try {
        await this.disableInspectMode();
        const { object } = await this.sendCommand("DOM.resolveNode", { backendNodeId: p.backendNodeId, objectGroup: "codex-selection" });
        try {
          await callback(await this.#call(object.objectId, describeElement, [this.#styles()]));
        } finally {
          await this.sendCommand("Runtime.releaseObjectGroup", { objectGroup: "codex-selection" });
        }
      } catch (error) {
        onError(error);
      }
    }
    if (this.#console.length > LIMIT) this.#console.splice(0, this.#console.length - LIMIT);
  }
  getConsoleLogs(level = "all") {
    return this.#console.filter((item) => level === "all" || item.level === "error" || (level === "warn" && item.level === "warn"));
  }
  getNetworkEntries(filter = "all") {
    return [...this.#network.values()].filter((item) => filter !== "failed" || item.error || item.status >= 400);
  }
  async getResponseBody(requestId) {
    const entry = this.#network.get(requestId);
    if (!entry) throw new Error("Network request is no longer available");
    if (!entry.finished) throw new Error("Network request has not finished");
    if (entry.size > MAX_BODY) throw new Error("Response body exceeds 2 MiB");
    const result = await this.sendCommand("Network.getResponseBody", { requestId });
    if (Buffer.byteLength(result.body, result.base64Encoded ? "base64" : "utf8") > MAX_BODY) throw new Error("Response body exceeds 2 MiB");
    return result;
  }
  async evaluate(expression) {
    if (typeof expression !== "string" || expression.length > 65536) throw new Error("Invalid browser expression");
    const result = await this.sendCommand("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      timeout: Math.max(1, Math.min(10000, (this.#budget.getStore()?.deadline ?? Infinity) - performance.now())),
    });
    return this.#value(result);
  }
  #value(response) {
    if (response.exceptionDetails)
      throw new Error(shorten(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text));
    const result = response.result;
    const value = result?.unserializableValue ?? result?.value ?? null;
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_BODY) throw new Error("Browser result exceeds 2 MiB");
    return value;
  }
  async #call(objectId, fn, values = []) {
    return this.#value(
      await this.sendCommand("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: fn.toString(),
        arguments: values.map((value) => ({ value })),
        returnByValue: true,
        awaitPromise: true,
      }),
    );
  }
  async #element(selector, action) {
    if (typeof selector !== "string" || !selector || selector.length > 65536) throw new Error("Invalid element selector");
    const group = `codex-element-${++this.#group}`;
    const response = await this.sendCommand("Runtime.evaluate", {
      expression: `(${findElement})(${JSON.stringify(selector)})`,
      objectGroup: group,
    });
    if (response.exceptionDetails) throw new Error(shorten(response.exceptionDetails.text));
    try {
      return response.result?.objectId ? await action(response.result.objectId) : null;
    } finally {
      if (this.isAttached()) void this.#wc.debugger.sendCommand("Runtime.releaseObjectGroup", { objectGroup: group }).catch(() => {});
    }
  }
  #styles() {
    return ["display", "position", "color", "background-color", "font-family", "font-size", "margin", "padding", "width", "height"];
  }
  async inspectElement(selector, styles = this.#styles()) {
    if (!Array.isArray(styles) || styles.length > 100 || styles.some((value) => typeof value !== "string" || value.length > 200))
      throw new Error("Invalid style properties");
    return this.#element(selector, (objectId) => this.#call(objectId, describeElement, [styles]));
  }
  async #point(objectId) {
    const point = await this.#call(objectId, function () {
      this.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const r = this.getBoundingClientRect(),
        style = getComputedStyle(this);
      if (
        !this.isConnected ||
        !r.width ||
        !r.height ||
        style.visibility !== "visible" ||
        style.display === "none" ||
        style.opacity === "0" ||
        this.disabled
      )
        throw new Error("Element is not visible or enabled");
      return { x: Math.min(innerWidth - 1, Math.max(0, r.x + r.width / 2)), y: Math.min(innerHeight - 1, Math.max(0, r.y + r.height / 2)) };
    });
    await this.#guard?.(this, [point]);
    this.#check();
    const hit = await this.#call(
      objectId,
      function (point) {
        const r = this.getBoundingClientRect();
        let target = document.elementFromPoint(point.x, point.y);
        while (target?.shadowRoot) {
          const next = target.shadowRoot.elementFromPoint(point.x, point.y);
          if (!next || next === target) break;
          target = next;
        }
        return (
          this.isConnected &&
          point.x >= r.left &&
          point.x <= r.right &&
          point.y >= r.top &&
          point.y <= r.bottom &&
          (target === this || this.contains(target))
        );
      },
      [point],
    );
    if (!hit) throw new Error("Element moved or is covered by another element");
    return point;
  }
  setMousePressGuard(guard) {
    this.#guard = guard;
  }
  async resolveFrameChainAtPoint(x, y) {
    const hit = await this.sendCommand("DOM.getNodeForLocation", { x: Math.floor(x), y: Math.floor(y), includeUserAgentShadowDOM: true });
    const { node } = await this.sendCommand("DOM.describeNode", { backendNodeId: hit.backendNodeId, depth: 0 });
    const frameId = node.nodeName === "IFRAME" || node.nodeName === "FRAME" ? node.frameId : hit.frameId;
    const { frameTree } = await this.sendCommand("Page.getFrameTree");
    const find = (tree) => (tree.frame.id === frameId ? tree.frame : (tree.childFrames ?? []).map(find).find(Boolean));
    const frame = find(frameTree);
    if (!frame) return { ok: false };
    const url = new URL(frame.url),
      origin = url.origin === "null" ? frame.securityOrigin : url.origin;
    if (!origin || origin === "://") return { ok: false };
    return { ok: true, innermostOrigin: url.protocol === "file:" ? url.href : origin, frameId };
  }
  async click(selector, { doubleClick = false } = {}) {
    return this.#element(selector, async (objectId) => {
      const point = await this.#point(objectId);
      this.#wc.focus();
      await this.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      for (let count = 1; count <= (doubleClick ? 2 : 1); count++) {
        this.#pressed = true;
        try {
          await this.sendCommand("Input.dispatchMouseEvent", {
            type: "mousePressed",
            ...point,
            button: "left",
            buttons: 1,
            clickCount: count,
          });
          await this.sendCommand("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            ...point,
            button: "left",
            buttons: 0,
            clickCount: count,
          });
          this.#pressed = false;
        } finally {
          this.#releasePointer();
        }
      }
      return true;
    });
  }
  async fill(selector, value) {
    if (typeof value !== "string" || value.length > 65536) throw new Error("Invalid input value");
    return this.#element(selector, async (objectId) => {
      const kind = await this.#call(objectId, function () {
        if (
          this.readOnly ||
          this.disabled ||
          (this.tagName === "INPUT" &&
            ["file", "hidden", "checkbox", "radio", "button", "submit", "reset", "image", "range", "color"].includes(this.type))
        )
          throw new Error("Element does not accept text");
        if (!["INPUT", "TEXTAREA", "SELECT"].includes(this.tagName) && !this.isContentEditable)
          throw new Error("Element does not accept text");
        return this.tagName === "SELECT" ||
          (this.tagName === "INPUT" && ["date", "datetime-local", "time", "month", "week"].includes(this.type))
          ? "value"
          : "text";
      });
      await this.#point(objectId);
      await this.sendCommand("DOM.focus", { objectId });
      if (kind === "value")
        return this.#call(
          objectId,
          function (value) {
            if (this.tagName === "SELECT" && ![...this.options].some((option) => option.value === value))
              throw new Error("Select option does not exist");
            const prototype = this.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(prototype, "value").set.call(this, value);
            this.dispatchEvent(new Event("input", { bubbles: true }));
            this.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          },
          [value],
        );
      await this.sendCommand("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        modifiers: process.platform === "darwin" ? 4 : 2,
      });
      await this.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
      if (value) await this.sendCommand("Input.insertText", { text: value });
      else {
        await this.sendCommand("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Backspace",
          code: "Backspace",
          windowsVirtualKeyCode: 8,
        });
        await this.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
      }
      return true;
    });
  }
  async capturePage() {
    this.#check();
    return this.#wc.capturePage();
  }
  async takeScreenshot(scale = 1) {
    if (!Number.isFinite(scale) || scale < 0.1 || scale > 1) throw new Error("Screenshot scale must be between 0.1 and 1");
    let image = await this.capturePage();
    if (image.isEmpty()) throw new Error("Browser page has not painted");
    if (scale !== 1) {
      const size = image.getSize();
      image = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) });
    }
    return image.toPNG().toString("base64");
  }
  async takeSnapshot() {
    return this.sendCommand("Accessibility.getFullAXTree", { depth: 50 });
  }
  formatSnapshotAsText({ nodes }) {
    const index = new Map(nodes.map((node) => [node.nodeId, node])),
      visited = new Set(),
      lines = [];
    const visit = (node, depth) => {
      if (!node || visited.has(node.nodeId) || visited.size >= 2000) return;
      visited.add(node.nodeId);
      if (!node.ignored) {
        const attributes = (node.properties ?? [])
          .filter((prop) => ["checked", "selected", "disabled", "expanded", "required"].includes(prop.name))
          .map((prop) => `${prop.name}=${JSON.stringify(prop.value.value)}`)
          .join(" ");
        lines.push(
          `${"  ".repeat(Math.min(depth, 50))}${node.role?.value ?? "node"} ${JSON.stringify(shorten(node.name?.value))}${node.value ? " value=" + JSON.stringify(shorten(node.value.value)) : ""}${attributes ? " " + attributes : ""}`,
        );
      }
      for (const child of node.childIds ?? []) visit(index.get(child), depth + (node.ignored ? 0 : 1));
    };
    for (const node of nodes) if (!node.parentId) visit(node, 0);
    return lines.join("\n").slice(0, 256000);
  }
  async setViewport(width, height) {
    if (![width, height].every((n) => Number.isInteger(n) && n >= 1 && n <= 9999)) throw new Error("Invalid viewport dimensions");
    await this.sendCommand("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  }
  async clearViewport() {
    await this.sendCommand("Emulation.clearDeviceMetricsOverride");
  }
  async setColorScheme(value) {
    if (!["light", "dark"].includes(value)) throw new Error("Invalid color scheme");
    await this.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
  }
  async enableInspectMode(callback, onError = (error) => console.error("Browser element selection failed:", error.message)) {
    this.#selection = { callback, onError };
    try {
      await this.sendCommand("Overlay.setInspectMode", {
        mode: "searchForNode",
        highlightConfig: { showInfo: true, contentColor: { r: 70, g: 150, b: 240, a: 0.25 } },
      });
    } catch (error) {
      this.#selection = undefined;
      throw error;
    }
  }
  async disableInspectMode() {
    this.#selection = undefined;
    await this.sendCommand("Overlay.setInspectMode", { mode: "none", highlightConfig: {} });
  }
}
