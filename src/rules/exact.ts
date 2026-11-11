// exact-repeat: 최근 창 안에서 같은 정확 서명이 몇 번째인지 센다(이번 호출 포함).
// 차단된 시도도 센다 — 모델이 같은 호출을 고집하면 block → stop 으로 올라가야 하므로.

import type { Entry } from './shared.js';

export function countExact(window: Entry[], exact: string): number {
  let n = 1;
  for (const e of window) if (e.exact === exact) n += 1;
  return n;
}
