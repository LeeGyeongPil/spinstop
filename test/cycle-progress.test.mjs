// AC-4: 순환·무진전·같은 오류 반복.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoopGuard } from 'spinstop';

// step 하나 = 호출 하나
function stepCall(guard, toolName, input, outcome = { output: 'same' }) {
  const c = { toolName, input };
  const v = guard.check(c);
  const blocked = v.action === 'block' || v.action === 'stop';
  guard.record(c, blocked ? { blocked: true } : outcome);
  const end = guard.endStep();
  return { v, end };
}

test('cycle rule: A(x), B(y) repeated 3 times is blocked as a cycle', () => {
  // cycle 규칙만 보려고 exact·near 를 끈다(기본값에서는 exact-repeat 가 같은 시점이나 더 먼저 잡는다 — 아래 테스트)
  const guard = createLoopGuard({ exact: false, near: false, noProgress: false });
  const seq = [];
  for (let r = 0; r < 4; r++) {
    seq.push(stepCall(guard, 'A', { x: 1 }).v);
    seq.push(stepCall(guard, 'B', { y: 2 }).v);
  }
  // 2주기째(4번째 step)에 warn, 3주기째 끝(6번째 step)에 block, 4주기째 끝(8번째)에 stop
  assert.deepEqual(seq.map((v) => v.action), ['allow', 'allow', 'allow', 'warn', 'warn', 'block', 'block', 'stop']);
  assert.equal(seq[5].rule, 'cycle');
  assert.equal(seq[5].count, 3);
  assert.match(seq[5].message, /2-step cycle 3 times/);
});

test('with default options a ping-pong is blocked by the 5th call and the cycle is reported too', () => {
  const guard = createLoopGuard();
  const seq = [];
  for (let r = 0; r < 3; r++) {
    seq.push(stepCall(guard, 'search_docs', { q: 'auth' }).v);
    seq.push(stepCall(guard, 'open_page', { url: '/auth' }).v);
  }
  assert.equal(seq[4].action, 'block');
  assert.equal(seq[4].rule, 'exact-repeat');
  assert.ok(seq[3].also?.includes('cycle'));
});

test('a single repeated step is not a cycle (period 1 belongs to exact-repeat)', () => {
  const guard = createLoopGuard({ exact: false, near: false, noProgress: false });
  for (let i = 0; i < 6; i++) assert.equal(stepCall(guard, 'A', { x: 1 }).v.action, 'allow');
});

test('the same error repeated (args differ only by requestId) is detected', () => {
  const guard = createLoopGuard();
  const err = { isError: true, output: new Error('EACCES: permission denied, open /srv/fixture/report.csv') };
  const seq = [1, 2, 3].map((n) => stepCall(guard, 'write_file', { path: '/srv/fixture/report.csv', requestId: `req-${n}` }, err).v);
  assert.deepEqual(seq.map((v) => v.action), ['allow', 'warn', 'block']);
  assert.equal(seq[2].rule, 'near-repeat');
});

test('no-progress: 5 steps in a row without a new (call, result) pair makes shouldStop() true', () => {
  // no-progress 만 보려고 다른 규칙을 끈다
  const guard = createLoopGuard({ exact: false, near: false, cycle: false });
  const first = stepCall(guard, 'read_file', { path: '/srv/fixture/a.txt' }, { output: 'hello' });
  assert.equal(first.end.action, 'allow');
  const ends = [];
  for (let i = 0; i < 5; i++) ends.push(stepCall(guard, 'read_file', { path: '/srv/fixture/a.txt' }, { output: 'hello' }).end);
  assert.deepEqual(ends.map((e) => e.action), ['allow', 'allow', 'warn', 'warn', 'stop']);
  assert.equal(ends[4].rule, 'no-progress');
  assert.equal(ends[4].count, 5);
  assert.equal(guard.shouldStop(), true);
  assert.equal(guard.history().at(-1).phase, 'step');
});

test('no-progress: a new result resets the streak, exempt-only steps are neutral', () => {
  const guard = createLoopGuard({ exact: false, near: false, cycle: false, tools: { poll: { exempt: true } } });
  stepCall(guard, 'read', { p: 1 }, { output: 'v1' });
  stepCall(guard, 'read', { p: 1 }, { output: 'v1' });
  stepCall(guard, 'read', { p: 1 }, { output: 'v1' });
  for (let i = 0; i < 5; i++) stepCall(guard, 'poll', { id: 1 }, { output: 'running' });
  const fresh = stepCall(guard, 'read', { p: 1 }, { output: 'v2' }); // 새 결과 → 진전
  assert.equal(fresh.end.action, 'allow');
  assert.equal(guard.shouldStop(), false);
});
