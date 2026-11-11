#!/usr/bin/env node
// spinstop CLI: 기록된 에이전트 실행을 다시 돌려 임계값을 맞춘다.
// 종료 코드: 0 정상, 1 --fail-on 수준 이상이 나옴, 2 사용법·입력 오류.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rank } from './rules/shared.js';
import { loadTrace } from './replay/load.js';
import { replayTrace } from './replay/run.js';
import { renderJson, renderTable } from './replay/render.js';
import type { Action, LoopGuardOptions } from './types.js';

const HELP = `spinstop — stop AI agents from spinning on repeated tool calls

Usage:
  spinstop replay <trace> [--config <file.json>] [--fail-on warn|block|stop] [--format table|json]
  spinstop --help | --version

replay  Feed a recorded run through the loop guard and show, per tool call,
        what spinstop would have done (allow / warn / block / stop).

Trace formats:
  - AI SDK steps:  JSON.stringify(result.steps)  (or a result object with "steps")
  - JSONL records: {"step":1,"toolName":"search","input":{...},"output":...,"isError":false}

Options:
  -c, --config   JSON file with LoopGuardOptions (window, escalation, near, cycle, noProgress, tools)
      --fail-on  exit with code 1 if any call reaches this level (for CI)
      --format   table (default) or json
`;

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}

function readConfig(file: string | undefined): LoopGuardOptions {
  if (!file) return {};
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${file}: config must be a JSON object`);
  return value as LoopGuardOptions;
}

export function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (command === undefined || command === '-h' || command === '--help' || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === '-v' || command === '--version') {
    process.stdout.write(readVersion() + '\n');
    return 0;
  }
  if (command !== 'replay') {
    process.stderr.write(`spinstop: unknown command "${command}"\n\n${HELP}`);
    return 2;
  }

  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      'fail-on': { type: 'string' },
      format: { type: 'string', default: 'table' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const file = positionals[0];
  if (!file) throw new Error('replay needs a trace file');

  const failOn = values['fail-on'] as Action | undefined;
  if (failOn !== undefined && !['warn', 'block', 'stop'].includes(failOn)) throw new Error('--fail-on must be warn, block or stop');
  if (values.format !== 'table' && values.format !== 'json') throw new Error('--format must be table or json');

  const result = replayTrace(loadTrace(file), readConfig(values.config));
  process.stdout.write((values.format === 'json' ? renderJson(result, file) : renderTable(result, file)) + '\n');

  if (failOn && rank(result.worst) >= rank(failOn)) return 1;
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(msg.startsWith('spinstop: ') ? `${msg}\n` : `spinstop: ${msg}\n`);
  process.exitCode = 2;
}
