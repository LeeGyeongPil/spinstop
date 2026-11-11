# Changelog

## 0.1.0 — unreleased

First version.

- Core loop guard (`createLoopGuard`) with no runtime dependencies: deterministic call signatures, `exact-repeat`, `near-repeat` (counts only calls whose results were not new), `cycle`, `no-progress` and `max-calls` rules, warn → block → stop escalation, per-tool policies (`exempt`, `ignore`, `loopKey`, `maxCalls`, `near`), JSON `history()` and `stats()`.
- Vercel AI SDK adapter (`spinstop/ai`): `guardTools` (blocks before `execute` runs), `loopStopWhen`, `loopPrepareStep`, `withLoopGuard`.
- OpenAI Agents JS adapter (`spinstop/openai-agents`): `loopInputGuardrail` (`rejectContent` / `throwException`), `recordAgentToolResults`.
- `spinstop replay` CLI for recorded AI SDK steps and JSONL traces, with `--config`, `--fail-on` and `--format json`.
- Practice-mock demos (`npm run demo`, `npm run demo:agents`) and three example traces.
- Fix: `near.maskNumbers` now defaults to `'text'` (numbers are masked only inside multi-word text), so checking different order IDs or split files with equal results is no longer a near-repeat; `true` keeps the old mask-everything behavior.
- `createLoopGuard`, `guardTools` and `spinstop replay --config` reject invalid options (non-positive or non-integer numbers, `escalation` not ordered `warn <= block <= stop`) with a `TypeError` that names the field.
