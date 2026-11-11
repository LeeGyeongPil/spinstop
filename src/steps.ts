// AI SDK step 객체(또는 그것을 JSON 으로 저장한 것)에서 도구 호출과 결과를 꺼낸다.
// 어댑터(loopStopWhen)와 replay CLI 가 같은 해석을 쓰도록 한곳에 둔다.

import { errorText } from './signature.js';
import type { ToolOutcome } from './types.js';

export interface StepCall {
  toolName: string;
  input: unknown;
  callId: string;
  outcome?: ToolOutcome;
}

type Loose = Record<string, unknown>;

function asObject(value: unknown): Loose | undefined {
  return value !== null && typeof value === 'object' ? (value as Loose) : undefined;
}

// JSON 으로 저장된 Error 는 {} 가 되므로 메시지가 없으면 "error" 로 둔다.
function errorOf(value: unknown): unknown {
  const obj = asObject(value);
  if (obj && !(value instanceof Error) && Object.keys(obj).length === 0) return 'error';
  return errorText(value);
}

/** step 하나의 도구 호출(들어온 순서)과 그 결과. content 가 없으면 toolCalls/toolResults 를 본다. */
export function callsOfStep(step: unknown): StepCall[] {
  const s = asObject(step);
  if (!s) return [];
  const parts: Loose[] = [];
  if (Array.isArray(s.content)) {
    for (const p of s.content) {
      const part = asObject(p);
      if (part) parts.push(part);
    }
  } else {
    for (const p of [...(Array.isArray(s.toolCalls) ? s.toolCalls : []), ...(Array.isArray(s.toolResults) ? s.toolResults : [])]) {
      const part = asObject(p);
      if (part) parts.push({ type: 'output' in part ? 'tool-result' : 'tool-call', ...part });
    }
  }

  const outcomes = new Map<string, ToolOutcome>();
  for (const part of parts) {
    const id = String(part.toolCallId ?? '');
    if (part.type === 'tool-result') outcomes.set(id, { output: part.output });
    if (part.type === 'tool-error') outcomes.set(id, { isError: true, output: errorOf(part.error) });
  }

  const calls: StepCall[] = [];
  for (const part of parts) {
    if (part.type !== 'tool-call') continue;
    const callId = String(part.toolCallId ?? `call-${calls.length + 1}`);
    calls.push({ toolName: String(part.toolName), input: part.input, callId, outcome: outcomes.get(callId) });
  }
  return calls;
}
