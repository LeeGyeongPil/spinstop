#!/usr/bin/env node
// spinstop CLI: 기록된 에이전트 실행을 다시 돌려 임계값을 맞춘다.
// 종료 코드: 0 정상, 1 --fail-on 수준 이상이 나옴, 2 사용법·입력 오류.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rank } from './rules/shared.js';
import { TraceError, loadTrace } from './replay/load.js';
import { replayTrace } from './replay/run.js';
import { renderJson, renderTable } from './replay/render.js';
import { MESSAGES, isLangValue, resolveLang, type Lang, type Messages } from './i18n.js';
import type { Action, LoopGuardOptions } from './types.js';

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}

function readConfig(file: string | undefined, m: Messages): LoopGuardOptions {
  if (!file) return {};
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(m.configNotObject(file));
  return value as LoopGuardOptions;
}

/** Pulls `--lang <v>` / `--lang=<v>` out of argv (any position, before a bare `--`). */
function extractLang(argv: string[]): { rest: string[]; value?: string; missing: boolean } {
  const rest: string[] = [];
  let value: string | undefined;
  let missing = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      rest.push(...argv.slice(i));
      break;
    }
    if (arg === '--lang') {
      const next = argv[i + 1];
      if (next === undefined) missing = true;
      else {
        value = next;
        i++;
      }
    } else if (arg.startsWith('--lang=')) {
      value = arg.slice('--lang='.length);
    } else rest.push(arg);
  }
  return { rest, value, missing };
}

/** Translates a trace input error; other errors pass through unchanged. */
function translate(err: unknown, m: Messages): unknown {
  if (!(err instanceof TraceError)) return err;
  switch (err.code) {
    case 'empty':
      return new Error(m.traceEmpty);
    case 'unrecognized':
      return new Error(m.traceUnrecognized);
    case 'line-not-json':
      return new Error(m.traceLineNotJson(err.line ?? 0));
    default:
      return new Error(m.traceLineNotRecord(err.line ?? 0));
  }
}

export function main(rawArgv: string[]): number {
  const { rest: argv, value: langFlag, missing } = extractLang(rawArgv);
  // An unusable --lang is reported in the language the environment would pick.
  const envLang: Lang = resolveLang(undefined);
  if (missing) throw new Error(MESSAGES[envLang].langNeedsValue);
  if (langFlag !== undefined && !isLangValue(langFlag)) throw new Error(MESSAGES[envLang].langInvalid(langFlag));
  const lang = resolveLang(langFlag);
  const m = MESSAGES[lang];

  const [command, ...rest] = argv;
  if (command === undefined || command === '-h' || command === '--help' || command === 'help') {
    process.stdout.write(m.help);
    return 0;
  }
  if (command === '-v' || command === '--version') {
    process.stdout.write(readVersion() + '\n');
    return 0;
  }
  if (command !== 'replay') {
    process.stderr.write(`spinstop: ${m.unknownCommand(command)}\n\n${m.help}`);
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
    process.stdout.write(m.help);
    return 0;
  }
  const file = positionals[0];
  if (!file) throw new Error(m.needsTraceFile);

  const failOn = values['fail-on'] as Action | undefined;
  if (failOn !== undefined && !['warn', 'block', 'stop'].includes(failOn)) throw new Error(m.failOnInvalid);
  if (values.format !== 'table' && values.format !== 'json') throw new Error(m.formatInvalid);

  let trace;
  try {
    trace = loadTrace(file);
  } catch (err) {
    throw translate(err, m);
  }
  const result = replayTrace(trace, readConfig(values.config, m));
  process.stdout.write((values.format === 'json' ? renderJson(result, file) : renderTable(result, file, lang)) + '\n');

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
