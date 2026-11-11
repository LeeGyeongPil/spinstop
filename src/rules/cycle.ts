// cycle: step 서명 열의 꼬리가 주기 p(2..maxPeriod)로 몇 번 반복되는지 센다.
// 예) A,B,A,B,A,B → 주기 2, 3회. 주기 1(같은 step 반복)은 exact-repeat 가 맡는다.

export interface CycleMatch {
  reps: number;
  period: number;
}

// [A,A] 나 [A,B,A,B] 처럼 더 짧은 주기로 쪼개지는 단위는 제외한다.
function isPrimitive(unit: string[]): boolean {
  const p = unit.length;
  for (let d = 1; d < p; d++) {
    if (p % d !== 0) continue;
    let periodic = true;
    for (let i = d; i < p; i++) {
      if (unit[i] !== unit[i - d]) {
        periodic = false;
        break;
      }
    }
    if (periodic) return false;
  }
  return true;
}

export function detectCycle(seq: string[], maxPeriod: number): CycleMatch {
  let best: CycleMatch = { reps: 0, period: 0 };
  for (let p = 2; p <= maxPeriod; p++) {
    if (seq.length < 2 * p) continue;
    if (!isPrimitive(seq.slice(-p))) continue;
    // 끝에서부터 seq[i] === seq[i + p] 가 이어지는 꼬리 길이
    let tail = p;
    for (let i = seq.length - p - 1; i >= 0 && seq[i] === seq[i + p]; i--) tail += 1;
    const reps = Math.floor(tail / p);
    if (reps > best.reps) best = { reps, period: p };
  }
  return best;
}
