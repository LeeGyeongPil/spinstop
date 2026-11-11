import type { GuardEvent, Verdict } from './types.js';

/** 가드가 block·stop 을 예외로 알릴 때 쓰는 오류. verdict 와 그 시점의 history 를 담는다. */
export class LoopDetectedError extends Error {
  readonly verdict: Verdict;
  readonly history: GuardEvent[];

  constructor(verdict: Verdict, history: GuardEvent[] = []) {
    super(verdict.message ?? `spinstop: loop detected (${verdict.rule ?? 'unknown'})`);
    this.name = 'LoopDetectedError';
    this.verdict = verdict;
    this.history = history;
  }
}
