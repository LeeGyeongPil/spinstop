// no-progress: step 하나가 새 (호출 서명, 결과 서명) 쌍을 하나라도 만들었는지 본다.
// 새 쌍이 없는 step 이 연속되면 그 수를 돌려준다.
//
// - 차단된 호출은 진전이 아니다.
// - 결과를 아직 모르는(pending) 호출은 진전으로 본다(모르면 무죄).
// - 면제(exempt) 호출만 있었던 step 은 중립: 연속 수를 바꾸지 않는다.

import type { Entry } from './shared.js';

export class ProgressTracker {
  private readonly seen = new Set<string>();
  private streakCount = 0;

  constructor(private readonly maxPairs = 5000) {}

  /** step 하나를 반영하고 현재 연속 무진전 step 수를 돌려준다. */
  observe(stepEntries: Entry[]): number {
    const counted = stepEntries.filter((e) => !e.exempt);
    if (counted.length === 0) return this.streakCount;

    let progressed = false;
    for (const e of counted) {
      if (e.kind === 'blocked') continue;
      if (e.kind === 'pending') {
        progressed = true;
        continue;
      }
      const pair = `${e.exact}|${e.result}`;
      if (!this.seen.has(pair)) {
        progressed = true;
        this.remember(pair);
      }
    }
    this.streakCount = progressed ? 0 : this.streakCount + 1;
    return this.streakCount;
  }

  get streak(): number {
    return this.streakCount;
  }

  // 상한을 넘으면 가장 오래된 쌍부터 잊는다(메모리 상한).
  private remember(pair: string): void {
    this.seen.add(pair);
    if (this.seen.size > this.maxPairs) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
  }

  reset(): void {
    this.seen.clear();
    this.streakCount = 0;
  }
}
