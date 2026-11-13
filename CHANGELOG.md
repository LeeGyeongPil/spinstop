# Changelog

## [0.2.0]

### Added

- `spinstop replay` screen language: English and Korean. Choose with `--lang en|ko` (before the command or after the trace), the `SPINSTOP_LANG` environment variable, or `LANG`, in that order of priority; values such as `ko`, `ko-KR`, `ko_KR`, `ko_KR.UTF-8` mean Korean, anything else English. An invalid `--lang` value exits with code `2`.
- `--lang` now also works with `--help` and `--version`.

### Changed

- On a Korean locale (`LANG=ko_KR.UTF-8`) the help, table, summary and the spinstop-authored CLI errors are now Korean. Exit codes, `--format json`, action and rule names, and guard messages are unchanged, so parse `--format json` instead of the table text. Errors raised by Node itself stay in English. English output is byte-for-byte the same as 0.1.0 except for one new `--lang` line in the help.

## [0.1.0]

First version.

- Core loop guard (`createLoopGuard`) with no runtime dependencies: deterministic call signatures, `exact-repeat`, `near-repeat` (counts only calls whose results were not new), `cycle`, `no-progress` and `max-calls` rules, warn → block → stop escalation, per-tool policies (`exempt`, `ignore`, `loopKey`, `maxCalls`, `near`), JSON `history()` and `stats()`.
- Vercel AI SDK adapter (`spinstop/ai`): `guardTools` (blocks before `execute` runs), `loopStopWhen`, `loopPrepareStep`, `withLoopGuard`.
- OpenAI Agents JS adapter (`spinstop/openai-agents`): `loopInputGuardrail` (`rejectContent` / `throwException`), `recordAgentToolResults`.
- `spinstop replay` CLI for recorded AI SDK steps and JSONL traces, with `--config`, `--fail-on` and `--format json`.
- Practice-mock demos (`npm run demo`, `npm run demo:agents`) and three example traces.
- Fix: `near.maskNumbers` now defaults to `'text'` (numbers are masked only inside multi-word text), so checking different order IDs or split files with equal results is no longer a near-repeat; `true` keeps the old mask-everything behavior.
- `createLoopGuard`, `guardTools` and `spinstop replay --config` reject invalid options (non-positive or non-integer numbers, `escalation` not ordered `warn <= block <= stop`) with a `TypeError` that names the field.

[0.2.0]: https://github.com/LeeGyeongPil/spinstop/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/LeeGyeongPil/spinstop/releases/tag/v0.1.0
