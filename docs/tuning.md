# Tuning spinstop with `spinstop replay`

The default thresholds are a starting point, not a benchmark result.
Every agent has its own "normal" amount of repetition: a polling tool may be called twenty times on purpose, while a `send_email` call should never repeat.
`spinstop replay` lets you check thresholds against runs you have already recorded, before you put the guard in front of real side effects.

## 1. Save a trace

**Vercel AI SDK** — save the steps of a finished run:

```js
import { writeFileSync } from 'node:fs';

const result = await generateText({ model, tools, prompt, stopWhen: isStepCount(20) });
writeFileSync('run.steps.json', JSON.stringify(result.steps));
```

`replay` reads the `content` array of each step (`tool-call`, `tool-result`, `tool-error` parts).
It also accepts the whole result object if it has a `steps` array.
Note: `JSON.stringify` turns an `Error` into `{}`, so a saved `tool-error` keeps only the fact that it failed, not the message.

**Anything else** — write one JSON object per line (JSONL):

```json
{"step":1,"toolName":"search","input":{"query":"weather seoul"},"output":{"hits":[]}}
{"step":2,"toolName":"search","input":{"query":"Seoul weather"},"output":{"hits":[]},"isError":false}
```

Lines with the same `step` number are one step (parallel calls). Without `step`, each line is its own step.

`examples/record-trace.mjs` shows how `examples/traces/stuck-search.steps.json` was produced from a mock run.

## 2. Read the table

```text
$ npx spinstop replay examples/traces/stuck-search.steps.json
spinstop replay: examples/traces/stuck-search.steps.json
AI SDK steps · 7 steps · 7 tool calls

step  tool    action  rule         count  would run
1     search  allow   -            -      yes
2     search  allow   -            -      yes
3     search  block   near-repeat  3      no
4     search  block   near-repeat  4      no
5     search  stop    near-repeat  5      no
6     search  stop    near-repeat  5      no
7     search  stop    near-repeat  5      no

first intervention: step 3 · first block: step 3 · stop: step 5
saved 5 of 7 executions (calls the guard would not have run)
message at step 3: spinstop: search was called 3 times with nearly the same arguments and returned nothing new. The call was not run. Try a different approach or answer with what you have.
```

- **action** — what the guard would have done before the call ran.
- **rule (+others)** — the rule that decided, plus other rules that also fired at warn level or higher.
- **would run** — `no` means the tool would not have been executed (blocked, or the run was already stopped).
- **saved** — how many executions in the trace the guard would have prevented.
- `(step end)` rows are `no-progress` decisions made when a step finished.

Replay records blocked calls as "not run", the same way a guarded run would, and then keeps feeding the rest of the trace. A real guarded run may have gone differently after the first block (the model sees the block message), so treat "saved" as an upper bound.

## 3. Change thresholds with `--config`

The config file is plain `LoopGuardOptions` as JSON (no functions). See `examples/spinstop.config.json`:

```json
{
  "window": 20,
  "escalation": { "warn": 2, "block": 3, "stop": 5 },
  "near": { "ignoreKeys": ["sessionId"] },
  "cycle": { "maxPeriod": 4 },
  "noProgress": { "warnAfter": 3, "stopAfter": 5 },
  "tools": {
    "poll_job": { "exempt": true },
    "search": { "ignore": ["filters.since"] },
    "send_email": { "maxCalls": 3 }
  }
}
```

```bash
npx spinstop replay run.steps.json --config spinstop.json
npx spinstop replay run.steps.json --config spinstop.json --format json   # machine-readable
```

Rules of thumb:

| You see | Try |
|---|---|
| A healthy run gets `warn`/`block` on a polling or status tool | `tools: { poll_job: { exempt: true } }` |
| Calls differ only by a field that does not matter (`page` for a fixed query, a trace id) | `ignore: ["field.path"]` or `loopKey: ["query"]` |
| `near-repeat` fires on calls that are really different (for example search phrases that differ only by a number) | `near: { maskNumbers: false }` (numbers inside text are kept too), or `tools: { x: { near: false } }` |
| A paging tool keeps returning the same empty page and nothing catches it | `near: { maskNumbers: true }` (masks every number; then `check_status({ orderId: 101 })`, `102` ... with equal results also count as near-repeats) |
| Loops are caught too late and side effects already repeated | lower `escalation.block` (for example `2`) |
| Long, productive runs get stopped by `no-progress` | raise `noProgress.stopAfter`, or check which tool returns identical results |

## 4. Use it in CI

Keep a few traces of runs that are known to be fine (like `examples/traces/pagination-ok.jsonl`) and check that the guard stays quiet on them:

```bash
npx spinstop replay traces/healthy-run.jsonl --config spinstop.json --fail-on block
```

Exit codes: `0` nothing reached the `--fail-on` level, `1` something did, `2` usage or input error.
Add traces of real stuck runs too, and expect exit code `1`, so a threshold change that stops catching them is noticed.
