Run a dynamic workflow: a JavaScript script that orchestrates many sub-agents deterministically. The run happens in the background. This tool returns right away with a run id; when the run ends you receive a `<workflow_result>` message with the script's return value, even if you have ended your turn. The user follows progress in the transcript card and the background tasks panel.

When to use it
- Only when the user has opted in to multi-agent orchestration: a developer message says Ultracode is on for this session, the user's message contains the keyword "ultracode", the user asks in their own words for a workflow or for many agents working in parallel, or the user names a saved workflow to run.
- Otherwise do not call it, even when a task would benefit. Do the work yourself, or describe what a workflow would do and roughly what it would cost, and ask. Workflows can start dozens of agents and use a lot of tokens.
- A good pattern is hybrid: look around yourself first to find the work list (files, failing tests, modules), then call the workflow tool to fan out over it. Keep each workflow one well-scoped fan-out and read its result before deciding the next step.

Arguments
- `script`: the script source, inline. Do not write it to a file first; every run saves its script and returns the path.
- `scriptPath`: run a script file instead, for example the saved copy of an earlier run that you edited.
- `name`: run a saved workflow by its `meta.name` (from `.codex/workflows/*.js` in the project or its parents, or `$CODEX_HOME/workflows/*.js`).
- `args`: any JSON value, passed to the script as the global `args`. Pass arrays and objects as real JSON, not as a JSON-encoded string.
- `resumeFromRunId`: rerun with `scriptPath` and reuse finished agents of an earlier run of this thread: calls whose prompt and options are unchanged are answered from that run's journal, until the first changed or new call; from there everything runs live.

Script shape
The first statement must be `export const meta = {...}`, a pure literal (no variables, calls, spreads or template interpolation):

    export const meta = {
      name: 'review-changes',
      description: 'Review the diff along three dimensions and verify each finding',
      phases: [{ title: 'Find', detail: 'one agent per dimension' }, { title: 'Verify' }],
    }
    phase('Find')
    const found = await parallel(DIMENSIONS.map((d) => () => agent(d.prompt, { label: d.key, schema: FINDINGS })))
    ...
    return verified

`name` and `description` are required; `phases` lists one entry per `phase()` title you will use (titles match exactly; an unlisted title just gets its own group). The body runs in an async context: use `await` and `return` at the top level. It is plain JavaScript, not TypeScript, with standard built-ins but no filesystem, network, imports or Node APIs. `Date.now()`, `Math.random()` and `new Date()` without arguments throw, because they would break resume; pass timestamps in through `args` and vary prompts by index instead.

Functions available to the script
- `agent(prompt, opts?)` starts one sub-agent and resolves to its final text. With `opts.schema` (a JSON Schema whose root is `{type: 'object', properties: {...}}`) the agent must answer with matching JSON and you get the parsed object. It resolves to `null` when the agent fails, so filter results with `.filter(Boolean)`. Options: `label` (display name), `phase` (group for this agent; use it inside `parallel`/`pipeline` stages rather than relying on the global `phase()`), `model` and `effort` (leave them out unless you are sure; agents inherit the session's model and effort), `agentType` (a configured agent role).
- `pipeline(items, stage1, stage2, ...)` runs every item through all stages independently, with no barrier between stages: item A can be in stage 3 while item B is in stage 1. Each stage gets `(previous, item, index)`; a stage that throws or returns `null` ends that item as `null`. Prefer it for multi-stage work.
- `parallel(thunks)` runs `() => ...` tasks concurrently and waits for all of them (a barrier). A task that throws becomes `null`; the call itself never rejects. Use it only when the next step needs every result together, such as deduplicating findings before verifying them.
- `phase(title)` starts a progress group for the agents that follow. `log(message)` records a progress note.
- `workflow(nameOrRef, args?)` runs a saved workflow (`'name'` or `{ scriptPath }`) inline as one step and returns its result. Its agents share this run's limits and appear under their own group. Only one level of nesting is allowed.
- `args` is the tool's `args` value; `budget` is `{ total: null, spent(), remaining() }`.

Sub-agents
- Each agent starts fresh with the same project instructions you have, and is told that its final message is the return value for the script, so it replies with raw data. Put everything a stage needs into its prompt.
- Agents run without asking for approval: they work inside the sandbox and anything needing escalation fails. They cannot start workflows or other agents.
- At most a handful of agents run at once (more calls queue), a run may start at most 1000 agents, and one `parallel` or `pipeline` call takes at most 4096 items.

Patterns worth reaching for: independent reviewers per finding that try to refute it (keep it only if a majority fail to), reviewers with distinct lenses (correctness, security, reproduction), loops that keep searching until a couple of rounds find nothing new, and a final critic asking what was missed. If the script deliberately limits coverage (top N, sampling), `log()` what was left out.
