/* Workflow script runtime. Joined into one line ahead of the script body: no line comments, and every statement ends with a semicolon. */
const __wfTools = tools;
const __wfNotify = notify;
const __wfArgs = JSON.parse(__wfArgsJson);
let __wfPhase = undefined;
let __wfInFlight = 0;
const __wfWaiters = [];
const __wfMsg = (error) => (error !== null && typeof error === 'object' && 'message' in error) ? String(error.message) : String(error);
const __wfEmit = (event) => { try { __wfNotify(JSON.stringify(event)); } catch (_) { } };
const __wfFail = (message) => __wfEmit({ wf: 'failure', message: String(message) });
const __wfGate = async () => { if (__wfInFlight < __wfMaxInFlight) { __wfInFlight += 1; return; } await new Promise((resolve) => __wfWaiters.push(resolve)); };
const __wfUngate = () => { const next = __wfWaiters.shift(); if (next) { next(); } else { __wfInFlight -= 1; } };
const __wfCopy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const __wfAgent = (scope) => async function agent(prompt, opts) {
  if (typeof prompt !== 'string' || prompt.trim() === '') { throw new TypeError('agent(prompt, opts): prompt must be a non-empty string'); }
  const o = opts === undefined || opts === null ? {} : opts;
  if (typeof o !== 'object') { throw new TypeError('agent(prompt, opts): opts must be an object'); }
  const phase = scope ? scope.phase : (o.phase !== undefined && o.phase !== null ? String(o.phase) : __wfPhase);
  await __wfGate();
  try {
    const reply = await __wfTools.__wf_agent({ prompt, label: o.label === undefined || o.label === null ? undefined : String(o.label), phase, schema: o.schema, model: o.model, effort: o.effort, agentType: o.agentType, isolation: o.isolation });
    return reply === null || reply === undefined || reply.value === undefined ? null : reply.value;
  } finally { __wfUngate(); }
};
globalThis.agent = __wfAgent(null);
globalThis.parallel = async function parallel(thunks) {
  if (!Array.isArray(thunks)) { throw new TypeError('parallel() expects an array of functions'); }
  if (thunks.length > 4096) { throw new RangeError('parallel() accepts at most 4096 items; got ' + thunks.length); }
  thunks.forEach((thunk, i) => { if (typeof thunk !== 'function') { throw new TypeError('parallel[' + i + '] is not a function; wrap each task as () => agent(...)'); } });
  const settled = await Promise.allSettled(thunks.map((thunk) => Promise.resolve().then(thunk)));
  return settled.map((outcome, i) => { if (outcome.status === 'fulfilled') { return outcome.value; } __wfFail('parallel[' + i + '] failed: ' + __wfMsg(outcome.reason)); return null; });
};
globalThis.pipeline = async function pipeline(items, ...stages) {
  if (!Array.isArray(items)) { throw new TypeError('pipeline() expects an array of items'); }
  if (items.length > 4096) { throw new RangeError('pipeline() accepts at most 4096 items; got ' + items.length); }
  stages.forEach((stage, i) => { if (typeof stage !== 'function') { throw new TypeError('pipeline stage ' + (i + 1) + ' is not a function'); } });
  return Promise.all(items.map(async (item, index) => {
    let value = item;
    for (let s = 0; s < stages.length; s += 1) {
      try { value = await stages[s](value, item, index); } catch (error) { __wfFail('pipeline[' + index + '] stage ' + (s + 1) + ' failed: ' + __wfMsg(error)); return null; }
      if (value === null) { return null; }
    }
    return value;
  }));
};
globalThis.phase = function phase(title) { __wfPhase = String(title); __wfEmit({ wf: 'phase', title: __wfPhase }); };
globalThis.log = function log(message) { __wfEmit({ wf: 'log', message: String(message) }); };
globalThis.console = Object.freeze({ log: (...parts) => log(parts.map(String).join(' ')), info: (...parts) => log(parts.map(String).join(' ')), warn: (...parts) => log('[warn] ' + parts.map(String).join(' ')), error: (...parts) => log('[error] ' + parts.map(String).join(' ')) });
globalThis.args = __wfArgs;
globalThis.budget = Object.freeze({ total: null, spent: () => 0, remaining: () => Infinity });
globalThis.workflow = async function workflow(ref, childArgs) {
  const spec = typeof ref === 'string' ? { name: ref } : (ref !== null && typeof ref === 'object' && typeof ref.scriptPath === 'string' ? { scriptPath: ref.scriptPath } : null);
  if (!spec) { throw new TypeError('workflow() expects a saved workflow name or { scriptPath }'); }
  const child = await __wfTools.__wf_child(spec);
  const run = (0, eval)('(async (agent, phase, log, workflow, args) => {\n' + child.body + '\n})');
  const nested = async () => { throw new Error('workflow() can only nest one level'); };
  try {
    return __wfCopy(await run(__wfAgent({ phase: child.phase }), () => { }, (message) => log('[' + child.name + '] ' + String(message)), nested, __wfCopy(childArgs)));
  } catch (error) { __wfFail('workflow ' + child.name + ' failed: ' + __wfMsg(error)); throw error; }
};
Math.random = () => { throw new Error('Math.random() is not available in workflow scripts; vary prompts by index instead'); };
const __wfNoClock = () => { throw new Error('Date.now() and new Date() without arguments are not available in workflow scripts; pass timestamps in through args'); };
globalThis.Date = new Proxy(Date, { construct(target, argv, newTarget) { if (argv.length === 0) { __wfNoClock(); } return Reflect.construct(target, argv, newTarget); }, apply() { return __wfNoClock(); }, get(target, key) { return key === 'now' ? __wfNoClock : Reflect.get(target, key); } });
const __wfFinish = async (main) => {
  let value;
  try { value = await main(); } catch (error) { await __wfTools.__wf_result({ error: __wfMsg(error) }); return; }
  if (typeof value === 'function') { await __wfTools.__wf_result({ error: 'the workflow returned a function; return JSON-serializable data' }); return; }
  let json;
  try { json = __wfCopy(value); } catch (error) { await __wfTools.__wf_result({ error: 'the workflow result is not JSON-serializable: ' + __wfMsg(error) }); return; }
  await __wfTools.__wf_result({ value: json === undefined ? null : json });
};
