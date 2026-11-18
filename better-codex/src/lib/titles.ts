/** Claude 3.6556 cef1e6037 Bn: the first six words, at most 60 characters; undefined for blank text. */
export function placeholderTitle(text: string): string | undefined {
  const words = text.trim().split(/\s+/);
  if (words[0] === "") return undefined;
  const chars = Array.from(words.slice(0, 6).join(" "));
  return chars.length > 60 ? chars.slice(0, 59).join("") + "…" : chars.join("");
}

/** Claude 3.6556 main-process LP: "<title> (fork)", then "(fork 2)", "(fork 3)" … */
export function forkTitle(title: string): string {
  const match = title.match(/^(.*) \(fork(?: (\d+))?\)$/);
  return match ? `${match[1]} (fork ${match[2] ? Number(match[2]) + 1 : 2})` : `${title} (fork)`;
}

/** The backend owns inference; only a short validated title crosses this boundary. */
export async function requestTitle(description: string, model: string | null, signal: AbortSignal): Promise<string | null> {
  const response = await fetch("/api/title", {
    method: "POST", headers: { "content-type": "application/json" }, signal,
    body: JSON.stringify({ description: description.slice(0, 4000).replace(/[\uD800-\uDBFF]$/, ""), ...(model ? { model } : {}) }),
  });
  if (!response.ok) throw new Error(`Title generation failed (HTTP ${response.status})`);
  const body: unknown = await response.json();
  const title = body && typeof body === "object" && "title" in body && typeof body.title === "string" ? body.title.trim() : "";
  return title && title.length <= 200 && !/[<>\r\n]/u.test(title) ? title : null;
}
