// replay 입력 읽기. 두 형식을 받는다.
//   1) AI SDK steps: JSON.stringify(result.steps) 로 저장한 배열(또는 { steps: [...] } 를 가진 결과 객체)
//   2) 정규화 JSONL: 한 줄에 { "step": 1, "toolName": "...", "input": {...}, "output": ..., "isError": false }

import { readFileSync } from 'node:fs';
import { callsOfStep } from '../steps.js';
import type { ToolOutcome } from '../types.js';

export interface TraceCall {
  toolName: string;
  input: unknown;
  callId: string;
  outcome?: ToolOutcome;
}

export interface Trace {
  format: 'ai-sdk-steps' | 'jsonl';
  /** step 별 호출 목록(들어온 순서). */
  steps: TraceCall[][];
}

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose => v !== null && typeof v === 'object' && !Array.isArray(v);
const looksLikeStep = (v: unknown) => isObject(v) && (Array.isArray(v.content) || Array.isArray(v.toolCalls));
const looksLikeRecord = (v: unknown) => isObject(v) && typeof v.toolName === 'string' && !looksLikeStep(v);

function fromSteps(steps: unknown[]): Trace {
  return { format: 'ai-sdk-steps', steps: steps.map((s) => callsOfStep(s)) };
}

function fromRecords(records: Loose[]): Trace {
  // step 번호가 같은 줄끼리 묶는다. step 이 없으면 줄마다 새 step.
  const steps: TraceCall[][] = [];
  let lastKey: unknown = Symbol('none');
  records.forEach((r, i) => {
    const key = r.step ?? Symbol(`line-${i}`);
    if (key !== lastKey || steps.length === 0) steps.push([]);
    lastKey = key;
    const outcome: ToolOutcome | undefined =
      r.blocked === true ? { blocked: true } : 'output' in r || r.isError !== undefined ? { output: r.output, isError: r.isError === true } : undefined;
    steps[steps.length - 1]!.push({
      toolName: String(r.toolName),
      input: r.input,
      callId: String(r.callId ?? `line-${i + 1}`),
      outcome,
    });
  });
  return { format: 'jsonl', steps };
}

/** 글자에서 트레이스를 읽는다. 형식을 알 수 없으면 오류. */
export function parseTrace(text: string): Trace {
  const trimmed = text.trim();
  if (trimmed === '') throw new Error('trace is empty');

  // 전체가 JSON 하나인지 먼저 본다.
  let whole: unknown;
  let isWhole = false;
  try {
    whole = JSON.parse(trimmed);
    isWhole = true;
  } catch {
    isWhole = false;
  }
  if (isWhole) {
    if (Array.isArray(whole)) {
      if (whole.length === 0) return { format: 'ai-sdk-steps', steps: [] };
      if (whole.every(looksLikeStep)) return fromSteps(whole);
      if (whole.every(looksLikeRecord)) return fromRecords(whole as Loose[]);
    } else if (isObject(whole) && Array.isArray(whole.steps)) {
      return fromSteps(whole.steps);
    } else if (looksLikeRecord(whole)) {
      return fromRecords([whole as Loose]);
    }
    throw new Error('unrecognized JSON: expected AI SDK steps (an array of steps or { steps }) or tool-call records');
  }

  // JSONL: 줄마다 기록 하나
  const records: Loose[] = [];
  trimmed.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`line ${i + 1}: not valid JSON`);
    }
    if (!looksLikeRecord(value)) throw new Error(`line ${i + 1}: expected an object with "toolName"`);
    records.push(value as Loose);
  });
  return fromRecords(records);
}

export function loadTrace(file: string): Trace {
  return parseTrace(readFileSync(file, 'utf8'));
}
