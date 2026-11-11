// near-repeat: 근사 서명이 같으면서 "결과가 새롭지 않았던" 이전 호출 수 + 1.
//
// 결과가 새롭지 않다 = 아래 중 하나
//   - 같은 근사 서명 묶음 안에서 같은 결과 서명이 두 번 이상 나왔다
//   - 오류였다
//   - 가드가 막았다
// 결과가 아직 없는(pending) 호출은 세지 않는다(모르면 무죄).
// 그래서 page=1,2,3… 처럼 근사 서명은 같아도 결과가 매번 다른 페이지 넘김은 반복으로 안 센다.

import type { Entry } from './shared.js';

export function countNear(window: Entry[], near: string): number {
  const same = window.filter((e) => e.near === near);

  // 결과 서명별 등장 횟수
  const seen = new Map<string, number>();
  for (const e of same) if (e.kind === 'ok') seen.set(e.result, (seen.get(e.result) ?? 0) + 1);

  let stale = 0;
  for (const e of same) {
    if (e.kind === 'error' || e.kind === 'blocked') stale += 1;
    else if (e.kind === 'ok' && (seen.get(e.result) ?? 0) >= 2) stale += 1;
  }
  return stale + 1;
}
