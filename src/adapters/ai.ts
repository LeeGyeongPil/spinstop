// Vercel AI SDK(ai@7) 어댑터. 'ai' 는 타입으로만 쓰므로 런타임에 불러오지 않는다.
//
//   guardTools      — 도구 execute 를 감싸 "실행 전" 차단 (부작용 반복을 막는 유일한 지점)
//   loopStopWhen    — step 끝 종료 조건. 래퍼 없이 단독으로 쓰면 사후 판정만 한다
//   loopPrepareStep — warn 을 다음 step 메시지로 알리고, 원하면 막힌 도구를 activeTools 에서 뺀다
//   withLoopGuard   — 위 셋을 한 번에 펼쳐 넣는 묶음

import type { ModelMessage, PrepareStepFunction, PrepareStepResult, StopCondition, ToolSet } from 'ai';
import { LoopDetectedError } from '../errors.js';
import { errorText } from '../signature.js';
import { callsOfStep } from '../steps.js';
import type { LoopGuard, ToolCallInfo } from '../types.js';

// 같은 가드를 쓰는 어댑터끼리 나누는 상태(가드가 사라지면 함께 사라진다).
interface AdapterState {
  /** guardTools 가 이미 기록한 callId(loopStopWhen 이 다시 세지 않게). step 을 읽으면 지운다. */
  recorded: Set<string>;
  /** guardTools 로 감싼 도구 이름(narrowTools 용). */
  toolNames: Set<string>;
  /** 이번 실행에서 block 된 도구. */
  blockedTools: Set<string>;
  /** 이미 읽은 step 객체. */
  seenSteps: WeakSet<object>;
  /** 사후 모드에서 block 이상이 나왔는지. */
  posthocStop: boolean;
  /** loopPrepareStep 이 마지막으로 알린 history 순번. */
  lastSeq: number;
}

const states = new WeakMap<LoopGuard, AdapterState>();

function stateOf(guard: LoopGuard): AdapterState {
  let st = states.get(guard);
  if (!st) {
    st = { recorded: new Set(), toolNames: new Set(), blockedTools: new Set(), seenSteps: new WeakSet(), posthocStop: false, lastSeq: 0 };
    states.set(guard, st);
  }
  return st;
}

let callCounter = 0;

// loopStopWhen 없이 guardTools 만 쓰면 recorded 가 비워지지 않으므로 상한을 둔다.
const MAX_TRACKED_CALLS = 1000;
function track(set: Set<string>, value: string): void {
  set.add(value);
  if (set.size > MAX_TRACKED_CALLS) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value != null && typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function';
}

// 스트리밍 도구: 조각은 그대로 흘려보내고 마지막 조각을 결과로 기록한다.
async function* recordStream(source: AsyncIterable<unknown>, call: ToolCallInfo, guard: LoopGuard): AsyncGenerator<unknown> {
  let last: unknown;
  try {
    for await (const chunk of source) {
      last = chunk;
      yield chunk;
    }
  } catch (err) {
    guard.record(call, { isError: true, output: errorText(err) });
    throw err;
  }
  guard.record(call, { output: last });
}

type AnyExecute = (input: unknown, options: { toolCallId?: string } & Record<string, unknown>) => unknown;

/**
 * 도구 집합의 execute 를 감싼다. block·stop 판정이면 실제 execute 를 부르지 않고
 * 판정 메시지("spinstop: …")를 도구 결과로 돌려준다(onBlock: 'throw' 면 LoopDetectedError → tool-error).
 */
export function guardTools<T extends ToolSet>(tools: T, guard: LoopGuard, opts: { onBlock?: 'result' | 'throw' } = {}): T {
  if (opts.onBlock !== undefined && opts.onBlock !== 'result' && opts.onBlock !== 'throw') {
    throw new TypeError(`spinstop: onBlock must be 'result' or 'throw', got ${JSON.stringify(opts.onBlock)}`);
  }
  const st = stateOf(guard);
  const out: Record<string, unknown> = {};

  for (const [name, original] of Object.entries(tools)) {
    st.toolNames.add(name);
    const execute = (original as { execute?: AnyExecute }).execute;
    if (typeof execute !== 'function') {
      out[name] = original; // execute 가 없는 도구(클라이언트·공급자 실행)는 그대로
      continue;
    }

    // async 함수로 만들지 않는다: 스트리밍 도구는 AsyncIterable 을 바로 돌려줘야 SDK 가 알아본다.
    const guarded: AnyExecute = (input, options) => {
      callCounter += 1;
      const call: ToolCallInfo = { toolName: name, input, callId: options?.toolCallId ?? `spinstop-${callCounter}` };
      track(st.recorded, call.callId!);

      // 1) 실행 전 판정 — 병렬 호출도 들어온 순서대로 여기서 하나씩 판정된다.
      const verdict = guard.check(call);
      if (verdict.action === 'block' || verdict.action === 'stop') {
        // 2) 막는다: 실제 execute 는 부르지 않는다.
        guard.record(call, { blocked: true });
        st.blockedTools.add(name);
        if (opts.onBlock === 'throw') throw new LoopDetectedError(verdict, guard.history());
        return verdict.message;
      }

      // 3) 실행 중으로 먼저 기록해 같은 step 의 다음 병렬 호출이 이 호출을 셀 수 있게 한다.
      guard.record(call);
      let result: unknown;
      try {
        result = execute(input, options);
      } catch (err) {
        guard.record(call, { isError: true, output: errorText(err) });
        throw err;
      }
      if (isAsyncIterable(result)) return recordStream(result, call, guard);
      return Promise.resolve(result).then(
        (output) => {
          guard.record(call, { output });
          return output;
        },
        (err: unknown) => {
          guard.record(call, { isError: true, output: errorText(err) });
          throw err;
        },
      );
    };
    out[name] = { ...(original as object), execute: guarded };
  }
  return out as T;
}

// 아직 안 읽은 step 을 가드에 반영한다(loopStopWhen·loopPrepareStep 공통, 여러 번 불려도 한 번만 센다).
function syncSteps(guard: LoopGuard, steps: readonly unknown[]): void {
  const st = stateOf(guard);
  // 새 실행의 첫 step 이면 어댑터 상태를 비운다(가드 자체 상태는 reset() 으로만 지운다).
  const first = steps[0];
  if (steps.length === 1 && typeof first === 'object' && first !== null && !st.seenSteps.has(first)) {
    st.posthocStop = false;
    st.blockedTools.clear();
  }

  for (const step of steps) {
    if (typeof step !== 'object' || step === null || st.seenSteps.has(step)) continue;
    st.seenSteps.add(step);
    for (const c of callsOfStep(step)) {
      // guardTools 가 이미 판정·기록한 호출은 건너뛴다.
      if (st.recorded.delete(c.callId)) continue;
      // 사후 모드: 이미 실행된 호출을 판정하고 기록한다. 막을 수 없으니 block 이상이면 멈춘다.
      const call: ToolCallInfo = { toolName: c.toolName, input: c.input, callId: c.callId };
      const verdict = guard.check(call);
      guard.record(call, c.outcome);
      if (verdict.action === 'block' || verdict.action === 'stop') st.posthocStop = true;
    }
    guard.endStep();
  }
}

/**
 * step 끝 종료 조건. guardTools 와 함께 쓰면 가드가 stop 에 닿았을 때 끝낸다.
 * 단독으로 쓰면(사후 모드) 끝난 step 의 호출을 판정하고 block 이상이면 끝낸다 —
 * 이때 그 호출은 이미 실행된 뒤다.
 */
export function loopStopWhen(guard: LoopGuard): StopCondition<any> {
  return ({ steps }) => {
    syncSteps(guard, steps);
    return guard.shouldStop() || stateOf(guard).posthocStop;
  };
}

export interface LoopPrepareStepOptions {
  /** warn 을 다음 step 메시지 끝에 user 역할 "[spinstop] …" 로 덧붙인다(기본 true). */
  warn?: boolean;
  /** block 된 도구를 다음 step 부터 activeTools 에서 뺀다(기본 false). */
  narrowTools?: boolean;
  /** guardTools 를 쓰지 않을 때 narrowTools 가 알아야 할 전체 도구 이름. */
  toolNames?: string[];
}

/** step 시작 전: 새로 생긴 warn 을 모델에 알리고, 원하면 막힌 도구를 activeTools 에서 뺀다. */
export function loopPrepareStep(guard: LoopGuard, opts: LoopPrepareStepOptions = {}): PrepareStepFunction<any> {
  const warn = opts.warn !== false;
  return ({ steps, messages }) => {
    syncSteps(guard, steps);
    const st = stateOf(guard);
    const history = guard.history();
    const lastSeq = history.at(-1)?.seq ?? 0;
    if (lastSeq < st.lastSeq) st.lastSeq = 0; // 가드가 reset 됐다
    const fresh = history.filter((e) => e.seq > st.lastSeq);
    st.lastSeq = lastSeq;

    const result: PrepareStepResult<any> = {};
    // block 은 이미 도구 결과로 모델에 전달됐으므로 warn 만 따로 알린다.
    const warnings = [...new Set(fresh.filter((e) => e.action === 'warn').map((e) => e.message))];
    if (warn && warnings.length > 0) {
      const note: ModelMessage = { role: 'user', content: `[spinstop] ${warnings.join(' ')}` };
      result.messages = [...messages, note];
    }
    if (opts.narrowTools && st.blockedTools.size > 0) {
      const all = new Set([...st.toolNames, ...(opts.toolNames ?? [])]);
      if (all.size > 0) result.activeTools = [...all].filter((n) => !st.blockedTools.has(n));
    }
    return Object.keys(result).length > 0 ? result : undefined;
  };
}

export interface WithLoopGuardOptions<T extends ToolSet> {
  tools: T;
  guard: LoopGuard;
  /** 기존 종료 조건. 없으면 안전 상한으로 20 step 을 넣는다. */
  stopWhen?: StopCondition<T> | StopCondition<T>[];
  /** 기존 prepareStep. 먼저 실행하고 그 결과 위에 spinstop 경고를 얹는다. */
  prepareStep?: PrepareStepFunction<T>;
  onBlock?: 'result' | 'throw';
  warn?: boolean;
  narrowTools?: boolean;
}

/** generateText·streamText·ToolLoopAgent 설정에 펼쳐 넣는 묶음: { tools, stopWhen, prepareStep }. */
export function withLoopGuard<T extends ToolSet>(o: WithLoopGuardOptions<T>): {
  tools: T;
  stopWhen: StopCondition<T>[];
  prepareStep: PrepareStepFunction<T>;
} {
  const tools = guardTools(o.tools, o.guard, { onBlock: o.onBlock });
  const cap: StopCondition<T> = ({ steps }) => steps.length >= 20;
  const userStops = o.stopWhen === undefined ? [cap] : Array.isArray(o.stopWhen) ? o.stopWhen : [o.stopWhen];
  const ours = loopPrepareStep(o.guard, { warn: o.warn, narrowTools: o.narrowTools });

  const prepareStep: PrepareStepFunction<T> = async (options) => {
    const userResult = o.prepareStep ? await o.prepareStep(options) : undefined;
    // 사용자가 messages 를 바꿨다면 그 위에 경고를 덧붙인다.
    const loopResult = await ours({ ...options, messages: userResult?.messages ?? options.messages } as Parameters<typeof ours>[0]);
    if (!userResult && !loopResult) return undefined;
    const merged: Record<string, unknown> = { ...(userResult ?? {}), ...(loopResult ?? {}) };
    if (userResult?.activeTools && loopResult?.activeTools) {
      const allowed = new Set(loopResult.activeTools as string[]);
      merged.activeTools = (userResult.activeTools as string[]).filter((n) => allowed.has(n));
    }
    return merged as PrepareStepResult<T>;
  };

  return { tools, stopWhen: [...userStops, loopStopWhen(o.guard) as StopCondition<T>], prepareStep };
}
