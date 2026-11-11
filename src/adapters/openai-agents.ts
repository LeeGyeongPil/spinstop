// OpenAI Agents JS(@openai/agents 0.21) 어댑터. 패키지는 타입으로만 쓰고 런타임에 불러오지 않는다.
//
//   loopInputGuardrail     — 도구별 inputGuardrails 에 넣는다. 실행 전에 판정해
//                            block 이면 rejectContent(도구 대신 메시지를 모델에), stop 이면 throwException(실행 종료)
//   recordAgentToolResults — agent_tool_end 로 실제 실행 결과를 기록하고 turn 이 끝나면 endStep
//
// 함정: agent_tool_start/agent_tool_end 는 가드레일이 거절한 호출에도 발생한다(프로브로 확인).
// 그래서 거절한 callId 를 기억해 두고 결과 기록에서 거른다.

import type { Agent, ToolInputGuardrailDefinition } from '@openai/agents';
import type { LoopGuard, ToolCallInfo, Verdict } from '../types.js';

interface AgentsState {
  /** 가드레일이 거절한 callId(실행으로 세지 않는다). */
  rejected: Set<string>;
  /** 이번 turn 에 판정했지만 아직 끝나지 않은 callId. 비면 turn 이 끝난 것. */
  inFlight: Set<string>;
}

const states = new WeakMap<LoopGuard, AgentsState>();

// recordAgentToolResults 없이 가드레일만 쓰면 Set 이 비워지지 않으므로 상한을 둔다.
const MAX_TRACKED_CALLS = 1000;
function track(set: Set<string>, value: string): void {
  set.add(value);
  if (set.size > MAX_TRACKED_CALLS) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
}

function stateOf(guard: LoopGuard): AgentsState {
  let st = states.get(guard);
  if (!st) {
    st = { rejected: new Set(), inFlight: new Set() };
    states.set(guard, st);
  }
  return st;
}

// 모델이 준 arguments(JSON 문자열)를 객체로. 깨진 JSON 이면 문자열 그대로 비교한다.
function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ToolGuardrailFunctionOutputFactory 와 같은 모양을 직접 만든다(런타임 import 없이).
const allow = (info?: unknown) => ({ outputInfo: info, behavior: { type: 'allow' as const } });
const reject = (message: string, info?: unknown) => ({ outputInfo: info, behavior: { type: 'rejectContent' as const, message } });
const abort = (info?: unknown) => ({ outputInfo: info, behavior: { type: 'throwException' as const } });

function info(verdict: Verdict) {
  return { spinstop: { action: verdict.action, rule: verdict.rule, count: verdict.count, message: verdict.message } };
}

/**
 * 도구 입력 가드레일. 같은 호출이 반복되면 실행 전에 막는다.
 * onStop: 'throw'(기본)면 stop 수준에서 throwException 으로 실행을 끝내고,
 * 'reject' 면 stop 도 거절 메시지로만 돌려준다.
 */
export function loopInputGuardrail(guard: LoopGuard, opts: { onStop?: 'throw' | 'reject'; name?: string } = {}): ToolInputGuardrailDefinition {
  const st = stateOf(guard);
  return {
    type: 'tool_input',
    name: opts.name ?? 'spinstop',
    // async 지만 await 가 없다: 한 turn 의 병렬 호출이 들어온 순서대로 판정·기록된다.
    run: async ({ toolCall }) => {
      const call: ToolCallInfo = { toolName: toolCall.name, input: parseArguments(toolCall.arguments), callId: toolCall.callId };
      track(st.inFlight, toolCall.callId);
      const verdict = guard.check(call);

      if (verdict.action === 'allow' || verdict.action === 'warn') {
        guard.record(call); // 실행 중 — 결과는 recordAgentToolResults 가 채운다
        return allow(verdict.action === 'warn' ? info(verdict) : undefined);
      }

      // block·stop: 실행하지 않는다.
      guard.record(call, { blocked: true });
      track(st.rejected, toolCall.callId);
      if (verdict.action === 'stop' && opts.onStop !== 'reject') {
        // 실행이 여기서 끝나므로 이 turn 의 대기 상태를 비운다(다음 실행에 남지 않게).
        st.inFlight.clear();
        st.rejected.clear();
        return abort(info(verdict));
      }
      return reject(verdict.message ?? 'spinstop: loop detected', info(verdict));
    },
  };
}

/**
 * agent_tool_end 로 실제 실행 결과를 가드에 기록한다(near-repeat·no-progress 가 결과를 보려면 필요).
 * 거절된 호출은 실행으로 세지 않는다. 한 turn 의 호출이 모두 끝나면 endStep 을 부른다.
 * 반환한 함수를 부르면 리스너를 뗀다.
 */
export function recordAgentToolResults(agent: Agent<any, any>, guard: LoopGuard): () => void {
  const st = stateOf(guard);
  const listener = (_ctx: unknown, tool: { name: string }, result: string, details: { toolCall: unknown }) => {
    const toolCall = details?.toolCall as { callId?: string; name?: string; arguments?: string } | undefined;
    const callId = toolCall?.callId;
    if (callId === undefined) return;

    if (st.rejected.delete(callId)) {
      // 거절된 호출: 결과는 우리 메시지일 뿐 실행이 아니다.
    } else if (st.inFlight.has(callId)) {
      const name = toolCall?.name ?? tool.name;
      guard.record({ toolName: name, input: parseArguments(toolCall?.arguments ?? ''), callId }, { output: result });
    }
    st.inFlight.delete(callId);
    if (st.inFlight.size === 0) guard.endStep();
  };
  agent.on('agent_tool_end', listener as never);
  return () => {
    agent.off('agent_tool_end', listener as never);
  };
}
