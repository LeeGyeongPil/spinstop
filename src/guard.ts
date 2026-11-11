// createLoopGuard: 규칙을 모아 한 번의 판정(Verdict)을 내리는 곳.
//
// 흐름(어댑터가 도구 호출마다 이 순서로 부른다)
//   1) check(call)        — 실행 전 판정. warn 이상이면 history 에 남긴다.
//   2) record(call)       — allow·warn 이면 "실행 중"으로 기록 → 실행 후 같은 callId 로 결과를 채운다.
//      record(call, {blocked:true}) — block·stop 이면 실행하지 않고 막았다고 기록.
//   3) endStep()          — step 이 끝나면 순환·무진전 상태를 갱신.

import { countExact } from './rules/exact.js';
import { countNear } from './rules/near.js';
import { detectCycle } from './rules/cycle.js';
import { ProgressTracker } from './rules/progress.js';
import { escalate, rank, type Entry } from './rules/shared.js';
import { hash, resultSignature, signature } from './signature.js';
import type {
  Action,
  Escalation,
  GuardEvent,
  GuardStats,
  LoopGuard,
  LoopGuardOptions,
  RuleId,
  ToolCallInfo,
  ToolOutcome,
  ToolPolicy,
  Verdict,
} from './types.js';

/** 기본 임계값 — 출발점일 뿐이다. 자기 트레이스로 `spinstop replay` 를 돌려 맞춘다. */
export const DEFAULTS = {
  window: 20,
  escalation: { warn: 2, block: 3, stop: 5 } satisfies Escalation,
  cycle: { maxPeriod: 4, escalation: { warn: 2, block: 3, stop: 4 } satisfies Escalation },
  noProgress: { warnAfter: 3, stopAfter: 5 },
  maxHistory: 1000,
} as const;

// 동률일 때 앞에 있는 규칙을 보고한다.
const RULE_ORDER: RuleId[] = ['exact-repeat', 'near-repeat', 'cycle', 'no-progress', 'max-calls'];

// 규칙 하나가 낸 후보 판정
interface Hit {
  rule: RuleId;
  action: Action;
  count: number;
  detail?: number; // cycle 의 주기, max-calls 의 상한
}

const SUFFIX: Record<Exclude<Action, 'allow'>, string> = {
  warn: 'You may be stuck in a loop; try a different approach.',
  block: 'The call was not run. Try a different approach or answer with what you have.',
  stop: 'The call was not run and the run is being stopped.',
};

function defaultMessage(hit: Hit, toolName: string | undefined): string {
  const tool = toolName ?? 'a tool';
  let what: string;
  switch (hit.rule) {
    case 'exact-repeat':
      what = `${tool} was called ${hit.count} times with the same arguments.`;
      break;
    case 'near-repeat':
      what = `${tool} was called ${hit.count} times with nearly the same arguments and returned nothing new.`;
      break;
    case 'cycle':
      what = `the last steps repeat the same ${hit.detail}-step cycle ${hit.count} times.`;
      break;
    case 'no-progress':
      what = `${hit.count} steps in a row produced no new tool results.`;
      break;
    case 'max-calls':
      what = `${tool} was called ${hit.count} times, over its limit of ${hit.detail}.`;
      break;
  }
  const suffix = toolName === undefined && hit.action === 'stop' ? 'Stopping the run.' : SUFFIX[hit.action as Exclude<Action, 'allow'>];
  return `spinstop: ${what} ${suffix}`;
}

// 가장 강한 action, 동률이면 RULE_ORDER 앞 규칙.
function pickStrongest(hits: Hit[]): { top?: Hit; also: RuleId[] } {
  const active = hits.filter((h) => h.action !== 'allow');
  if (active.length === 0) return { also: [] };
  active.sort((a, b) => rank(b.action) - rank(a.action) || RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule));
  const top = active[0]!;
  return { top, also: active.slice(1).map((h) => h.rule) };
}

function posInt(name: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`spinstop: ${name} must be a positive integer, got ${JSON.stringify(value)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// 잘못된 설정은 조용히 이상하게 동작하는 대신 생성 시점에 이름과 올바른 범위를 알려 주며 거부한다.
function validateOptions(options: unknown): void {
  if (!isRecord(options)) throw new TypeError('spinstop: options must be an object');
  const o = options as LoopGuardOptions & Record<string, unknown>;
  if (o.window !== undefined) posInt('window', o.window);
  if (o.maxHistory !== undefined) posInt('maxHistory', o.maxHistory);
  if (o.exact !== undefined && typeof o.exact !== 'boolean') throw new TypeError(`spinstop: exact must be a boolean, got ${JSON.stringify(o.exact)}`);
  if (o.message !== undefined && typeof o.message !== 'function') throw new TypeError('spinstop: message must be a function');

  if (o.escalation !== undefined) {
    if (!isRecord(o.escalation)) throw new TypeError('spinstop: escalation must be an object like { warn, block, stop }');
    for (const k of ['warn', 'block', 'stop'] as const) if (o.escalation[k] !== undefined) posInt(`escalation.${k}`, o.escalation[k]);
    const e = { ...DEFAULTS.escalation, ...o.escalation } as Escalation;
    if (!(e.warn <= e.block && e.block <= e.stop)) {
      throw new TypeError(`spinstop: escalation must satisfy warn <= block <= stop, got warn ${e.warn}, block ${e.block}, stop ${e.stop}`);
    }
  }
  if (o.near !== undefined && o.near !== false) {
    if (!isRecord(o.near)) throw new TypeError('spinstop: near must be false or an options object');
    const m = o.near.maskNumbers;
    if (m !== undefined && typeof m !== 'boolean' && m !== 'text') throw new TypeError(`spinstop: near.maskNumbers must be true, false or 'text', got ${JSON.stringify(m)}`);
    if (o.near.tokenSort !== undefined && typeof o.near.tokenSort !== 'boolean') throw new TypeError('spinstop: near.tokenSort must be a boolean');
    const keys = o.near.ignoreKeys;
    if (keys !== undefined && (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string'))) throw new TypeError('spinstop: near.ignoreKeys must be an array of strings');
  }
  if (o.cycle !== undefined && o.cycle !== false) {
    if (!isRecord(o.cycle)) throw new TypeError('spinstop: cycle must be false or an options object');
    if (o.cycle.maxPeriod !== undefined) posInt('cycle.maxPeriod', o.cycle.maxPeriod);
  }
  if (o.noProgress !== undefined && o.noProgress !== false) {
    if (!isRecord(o.noProgress)) throw new TypeError('spinstop: noProgress must be false or an options object');
    if (o.noProgress.warnAfter !== undefined) posInt('noProgress.warnAfter', o.noProgress.warnAfter);
    if (o.noProgress.stopAfter !== undefined) posInt('noProgress.stopAfter', o.noProgress.stopAfter);
    const w = (o.noProgress.warnAfter as number | undefined) ?? DEFAULTS.noProgress.warnAfter;
    const st = (o.noProgress.stopAfter as number | undefined) ?? DEFAULTS.noProgress.stopAfter;
    if (w > st) throw new TypeError(`spinstop: noProgress must satisfy warnAfter <= stopAfter, got warnAfter ${w}, stopAfter ${st}`);
  }
  if (o.tools !== undefined) {
    if (!isRecord(o.tools)) throw new TypeError('spinstop: tools must be an object keyed by tool name');
    for (const [name, p] of Object.entries(o.tools)) {
      if (!isRecord(p)) throw new TypeError(`spinstop: tools.${name} must be an object`);
      if (p.maxCalls !== undefined) posInt(`tools.${name}.maxCalls`, p.maxCalls);
      for (const k of ['exempt', 'near'] as const) {
        if (p[k] !== undefined && typeof p[k] !== 'boolean') throw new TypeError(`spinstop: tools.${name}.${k} must be a boolean`);
      }
      for (const k of ['ignore', 'loopKey'] as const) {
        const v = p[k];
        if (v !== undefined && (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))) throw new TypeError(`spinstop: tools.${name}.${k} must be an array of strings`);
      }
    }
  }
}

export function createLoopGuard(options: LoopGuardOptions = {}): LoopGuard {
  validateOptions(options);
  // ---- 설정 정리 ----
  const windowSize = Math.max(1, options.window ?? DEFAULTS.window);
  const esc: Escalation = { ...DEFAULTS.escalation, ...options.escalation };
  const exactOn = options.exact !== false;
  const nearOn = options.near !== false;
  const nearOptions = options.near === false ? undefined : options.near;
  const cycleOn = options.cycle !== false;
  const maxPeriod = Math.max(2, (options.cycle === false ? undefined : options.cycle?.maxPeriod) ?? DEFAULTS.cycle.maxPeriod);
  const progressOn = options.noProgress !== false;
  const warnAfter = (options.noProgress === false ? undefined : options.noProgress?.warnAfter) ?? DEFAULTS.noProgress.warnAfter;
  const stopAfter = (options.noProgress === false ? undefined : options.noProgress?.stopAfter) ?? DEFAULTS.noProgress.stopAfter;
  const maxHistory = Math.max(1, options.maxHistory ?? DEFAULTS.maxHistory);
  const policies = options.tools ?? {};

  // ---- 상태(모두 상한이 있다) ----
  let entries: Entry[] = []; // 최근 호출(창 + 여유분)
  let stepSigs: string[] = []; // 끝난 step 의 서명(순환 판정용)
  let events: GuardEvent[] = [];
  let seq = 0;
  let step = 1;
  let stopVerdict: Verdict | undefined;
  const toolCounts = new Map<string, number>();
  const progress = new ProgressTracker();
  const totals = { calls: 0, executed: 0, blocked: 0, steps: 0 };

  const policyOf = (toolName: string): ToolPolicy => policies[toolName] ?? {};

  function sigsOf(call: ToolCallInfo) {
    const policy = policyOf(call.toolName);
    const s = signature(call.toolName, call.input, policy, nearOptions);
    return { exact: hash(s.exact), near: hash(s.near), policy };
  }

  // exact·near 를 셀 최근 창: 면제 호출을 뺀 최근 windowSize 개
  function recentWindow(): Entry[] {
    const counted = entries.filter((e) => !e.exempt);
    return counted.slice(-windowSize);
  }

  function currentStepEntries(): Entry[] {
    return entries.filter((e) => e.step === step && !e.exempt);
  }

  function pushEvent(event: Omit<GuardEvent, 'seq'>): void {
    seq += 1;
    events.push({ seq, ...event });
    if (events.length > maxHistory) events = events.slice(-maxHistory);
  }

  function makeVerdict(hit: Hit | undefined, also: RuleId[], sig: string, call?: ToolCallInfo): Verdict {
    if (!hit) return { action: 'allow', signature: sig };
    const verdict: Verdict = { action: hit.action, rule: hit.rule, count: hit.count, signature: sig };
    if (also.length > 0) verdict.also = also;
    verdict.message = options.message ? options.message(verdict, call) : defaultMessage(hit, call?.toolName);
    return verdict;
  }

  function check(call: ToolCallInfo): Verdict {
    const { exact, near, policy } = sigsOf(call);
    const sig = `${call.toolName}#${exact}`;

    // stop 은 끈적하다: 한 번 닿으면 reset 전까지 모든 호출을 막는다.
    if (stopVerdict) {
      const v: Verdict = { ...stopVerdict, signature: sig };
      pushEvent({ step, phase: 'call', toolName: call.toolName, callId: call.callId, action: 'stop', rule: v.rule!, count: v.count ?? 0, message: v.message!, signature: sig });
      return v;
    }
    if (policy.exempt) return { action: 'allow', signature: sig };

    const window = recentWindow();
    const hits: Hit[] = [];

    if (exactOn) {
      const n = countExact(window, exact);
      hits.push({ rule: 'exact-repeat', action: escalate(n, esc), count: n });
    }
    if (nearOn && policy.near !== false) {
      const n = countNear(window, near);
      hits.push({ rule: 'near-repeat', action: escalate(n, esc), count: n });
    }
    if (cycleOn) {
      // 이번 호출이 들어간다고 가정한 현재 step 서명을 끝에 붙여 본다.
      const tentative = [...currentStepEntries().map((e) => e.exact), exact].sort().join(',');
      const match = detectCycle([...stepSigs, tentative], maxPeriod);
      if (match.reps > 0) {
        hits.push({ rule: 'cycle', action: escalate(match.reps, DEFAULTS.cycle.escalation), count: match.reps, detail: match.period });
      }
    }
    if (progressOn && progress.streak >= warnAfter) {
      hits.push({ rule: 'no-progress', action: 'warn', count: progress.streak });
    }
    if (policy.maxCalls !== undefined) {
      const n = (toolCounts.get(call.toolName) ?? 0) + 1;
      if (n > policy.maxCalls) hits.push({ rule: 'max-calls', action: 'block', count: n, detail: policy.maxCalls });
    }

    const { top, also } = pickStrongest(hits);
    const verdict = makeVerdict(top, also, sig, call);
    if (top) {
      pushEvent({
        step,
        phase: 'call',
        toolName: call.toolName,
        callId: call.callId,
        action: top.action as Exclude<Action, 'allow'>,
        rule: top.rule,
        count: top.count,
        message: verdict.message!,
        ...(also.length > 0 ? { also } : {}),
        signature: sig,
      });
      if (top.action === 'stop') stopVerdict = verdict;
    }
    return verdict;
  }

  function record(call: ToolCallInfo, outcome?: ToolOutcome): void {
    const kind: Entry['kind'] = !outcome ? 'pending' : outcome.blocked ? 'blocked' : outcome.isError ? 'error' : 'ok';
    const result = kind === 'ok' || kind === 'error' ? hash(resultSignature(outcome)) : '';

    // 같은 callId 가 이미 있으면(실행 중으로 넣어 둔 것) 결과만 채운다.
    if (call.callId !== undefined) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]!;
        if (e.callId === call.callId && e.toolName === call.toolName) {
          if (e.kind !== 'blocked' && kind === 'blocked') {
            totals.executed -= 1;
            totals.blocked += 1;
          }
          e.kind = kind;
          e.result = result;
          return;
        }
      }
    }

    const { exact, near, policy } = sigsOf(call);
    entries.push({ step, toolName: call.toolName, callId: call.callId, exact, near, exempt: policy.exempt === true, kind, result });
    // 창 + 여유분(실행 중 callId 를 찾을 수 있게)만 남긴다.
    const cap = windowSize * 2 + 256;
    if (entries.length > cap) entries = entries.slice(-cap);

    toolCounts.set(call.toolName, (toolCounts.get(call.toolName) ?? 0) + 1);
    totals.calls += 1;
    if (kind === 'blocked') totals.blocked += 1;
    else totals.executed += 1;
  }

  function endStep(): Verdict {
    const sig = `step:${step}`;
    const stepEntries = entries.filter((e) => e.step === step);
    const counted = stepEntries.filter((e) => !e.exempt);

    if (counted.length > 0) {
      stepSigs.push(counted.map((e) => e.exact).sort().join(','));
      // 순환 판정에는 최근 몇 주기만 있으면 된다.
      const keep = maxPeriod * 6;
      if (stepSigs.length > keep) stepSigs = stepSigs.slice(-keep);
    }
    const streak = progress.observe(stepEntries);
    const closedStep = step;
    step += 1;
    totals.steps += 1;

    if (!progressOn || counted.length === 0 || stopVerdict) return { action: 'allow', signature: sig };

    let hit: Hit | undefined;
    if (streak >= stopAfter) hit = { rule: 'no-progress', action: 'stop', count: streak };
    else if (streak >= warnAfter) hit = { rule: 'no-progress', action: 'warn', count: streak };
    const verdict = makeVerdict(hit, [], sig);
    if (hit) {
      pushEvent({ step: closedStep, phase: 'step', action: hit.action as Exclude<Action, 'allow'>, rule: hit.rule, count: hit.count, message: verdict.message!, signature: sig });
      if (hit.action === 'stop') stopVerdict = verdict;
    }
    return verdict;
  }

  return {
    check,
    record,
    endStep,
    shouldStop: () => stopVerdict !== undefined,
    // 사본을 돌려준다: 바깥에서 고쳐도 가드 상태는 그대로.
    history: () => events.map((e) => ({ ...e, ...(e.also ? { also: [...e.also] } : {}) })),
    stats: (): GuardStats => ({ ...totals, stopped: stopVerdict !== undefined }),
    reset() {
      entries = [];
      stepSigs = [];
      events = [];
      seq = 0;
      step = 1;
      stopVerdict = undefined;
      toolCounts.clear();
      progress.reset();
      totals.calls = 0;
      totals.executed = 0;
      totals.blocked = 0;
      totals.steps = 0;
    },
  };
}
