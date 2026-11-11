// 규칙들이 함께 쓰는 내부 자료형과 개입 수준 계산.

import type { Action, Escalation } from '../types.js';

/** 가드가 기억하는 호출 하나(서명은 해시로만 보관). */
export interface Entry {
  step: number;
  toolName: string;
  callId?: string;
  exact: string;
  near: string;
  exempt: boolean;
  /** 결과 종류: 실행 중 / 정상 / 오류 / 가드가 막음. */
  kind: 'pending' | 'ok' | 'error' | 'blocked';
  /** 결과 서명 해시(pending·blocked 면 빈 문자열). */
  result: string;
}

const RANK: Record<Action, number> = { allow: 0, warn: 1, block: 2, stop: 3 };

/** 셈 n 을 escalation 기준에 맞춰 개입 수준으로 바꾼다. */
export function escalate(n: number, esc: Escalation): Action {
  if (n >= esc.stop) return 'stop';
  if (n >= esc.block) return 'block';
  if (n >= esc.warn) return 'warn';
  return 'allow';
}

export function rank(action: Action): number {
  return RANK[action];
}
