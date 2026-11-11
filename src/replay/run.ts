// 기록된 트레이스를 가드에 그대로 흘려, 가드가 있었다면 어디서 무엇을 했을지 계산한다.
// 차단된 호출은 "실행되지 않았다"로 기록하고(가드가 있던 실행과 같게), 트레이스는 끝까지 흘린다.

import { createLoopGuard } from '../guard.js';
import { rank } from '../rules/shared.js';
import type { Action, LoopGuardOptions, RuleId } from '../types.js';
import type { Trace } from './load.js';

export interface ReplayRow {
  step: number;
  toolName: string;
  callId: string;
  action: Action;
  rule?: RuleId;
  count?: number;
  also?: RuleId[];
  message?: string;
  /** 가드가 있었다면 실행됐을지. */
  wouldRun: boolean;
}

export interface ReplayStepEvent {
  step: number;
  action: Action;
  rule: RuleId;
  count: number;
  message: string;
}

export interface ReplayResult {
  format: Trace['format'];
  steps: number;
  calls: number;
  rows: ReplayRow[];
  stepEvents: ReplayStepEvent[];
  /** warn 이상이 처음 나온 step. */
  firstIntervention?: number;
  firstBlock?: number;
  stopStep?: number;
  /** 가드가 있었다면 실행되지 않았을 호출 수. */
  saved: number;
  /** 가장 강한 개입. */
  worst: Action;
}

export function replayTrace(trace: Trace, options: LoopGuardOptions = {}): ReplayResult {
  const guard = createLoopGuard(options);
  const rows: ReplayRow[] = [];
  const stepEvents: ReplayStepEvent[] = [];
  let worst: Action = 'allow';
  let firstIntervention: number | undefined;
  let firstBlock: number | undefined;
  let stopStep: number | undefined;

  const note = (step: number, action: Action) => {
    if (rank(action) > rank(worst)) worst = action;
    if (rank(action) >= rank('warn') && firstIntervention === undefined) firstIntervention = step;
    if (rank(action) >= rank('block') && firstBlock === undefined) firstBlock = step;
    if (action === 'stop' && stopStep === undefined) stopStep = step;
  };

  trace.steps.forEach((calls, index) => {
    const step = index + 1;
    for (const c of calls) {
      const call = { toolName: c.toolName, input: c.input, callId: c.callId };
      const verdict = guard.check(call);
      const blocked = verdict.action === 'block' || verdict.action === 'stop';
      // 막혔다면 실행되지 않은 것으로, 아니면 트레이스의 실제 결과로 기록한다.
      guard.record(call, blocked ? { blocked: true } : c.outcome);
      rows.push({
        step,
        toolName: c.toolName,
        callId: c.callId,
        action: verdict.action,
        rule: verdict.rule,
        count: verdict.count,
        also: verdict.also,
        message: verdict.message,
        wouldRun: !blocked,
      });
      note(step, verdict.action);
    }
    const end = guard.endStep();
    if (end.action !== 'allow' && end.rule) {
      stepEvents.push({ step, action: end.action, rule: end.rule, count: end.count ?? 0, message: end.message ?? '' });
      note(step, end.action);
    }
  });

  return {
    format: trace.format,
    steps: trace.steps.length,
    calls: rows.length,
    rows,
    stepEvents,
    firstIntervention,
    firstBlock,
    stopStep,
    saved: rows.filter((r) => !r.wouldRun).length,
    worst,
  };
}
