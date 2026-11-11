// AC-2: 정확 반복 단계 개입 allow → warn → block → block → stop, history JSON, exempt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoopGuard, LoopDetectedError } from 'spinstop';

const call = (i, input = { to: 'team@example.com', subject: 'Weekly report' }) => ({ toolName: 'send_email', input, callId: `c${i}` });

// 어댑터가 하는 그대로: check → (block 이면 막았다고, 아니면 실행 결과를) record
function attempt(guard, c, output = { status: 'sent' }) {
  const v = guard.check(c);
  const blocked = v.action === 'block' || v.action === 'stop';
  guard.record(c, blocked ? { blocked: true } : { output });
  return v;
}

test('same call 1st..5th: allow, warn, block, block, stop', () => {
  const guard = createLoopGuard();
  const actions = [1, 2, 3, 4, 5].map((i) => attempt(guard, call(i)).action);
  assert.deepEqual(actions, ['allow', 'warn', 'block', 'block', 'stop']);
  assert.equal(guard.shouldStop(), true);
});

test('history() is JSON-serializable and every event has rule, count and action', () => {
  const guard = createLoopGuard();
  for (let i = 1; i <= 5; i++) attempt(guard, call(i));
  const history = guard.history();
  const roundTrip = JSON.parse(JSON.stringify(history));
  assert.deepEqual(roundTrip, history);
  assert.equal(history.length, 4);
  for (const e of history) {
    assert.equal(typeof e.rule, 'string');
    assert.equal(typeof e.count, 'number');
    assert.ok(['warn', 'block', 'stop'].includes(e.action));
    assert.match(e.message, /^spinstop: /);
  }
  assert.deepEqual(history.map((e) => [e.action, e.rule, e.count]), [
    ['warn', 'exact-repeat', 2],
    ['block', 'exact-repeat', 3],
    ['block', 'exact-repeat', 4],
    ['stop', 'exact-repeat', 5],
  ]);
  // 사본이므로 고쳐도 가드에는 영향이 없다
  history[0].action = 'stop';
  assert.equal(guard.history()[0].action, 'warn');
});

test('exempt tool stays allowed after 10 identical calls (but is still recorded)', () => {
  const guard = createLoopGuard({ tools: { poll_job: { exempt: true } } });
  for (let i = 1; i <= 10; i++) {
    const c = { toolName: 'poll_job', input: { id: 'job-1' }, callId: `p${i}` };
    assert.equal(attempt(guard, c, { state: 'running' }).action, 'allow');
    guard.endStep();
  }
  assert.equal(guard.history().length, 0);
  assert.equal(guard.stats().calls, 10);
  assert.equal(guard.shouldStop(), false);
});

test('stop is sticky until reset()', () => {
  const guard = createLoopGuard();
  for (let i = 1; i <= 5; i++) attempt(guard, call(i));
  const other = guard.check({ toolName: 'search', input: { q: 'new' } });
  assert.equal(other.action, 'stop');
  guard.reset();
  assert.equal(guard.shouldStop(), false);
  assert.deepEqual(guard.history(), []);
  assert.equal(guard.check(call(1)).action, 'allow');
});

test('blocked calls are counted as blocked, not executed', () => {
  const guard = createLoopGuard();
  for (let i = 1; i <= 4; i++) attempt(guard, call(i));
  assert.deepEqual(guard.stats(), { calls: 4, executed: 2, blocked: 2, steps: 0, stopped: false });
});

test('pending record is completed by callId (no double count)', () => {
  const guard = createLoopGuard();
  const c = call(1);
  guard.check(c);
  guard.record(c); // 실행 중
  guard.record(c, { output: 'ok' }); // 결과 채움
  assert.equal(guard.stats().calls, 1);
  assert.equal(guard.stats().executed, 1);
});

test('maxCalls policy blocks once the tool is over its limit', () => {
  const guard = createLoopGuard({ tools: { fetch_page: { maxCalls: 2 } } });
  const actions = [1, 2, 3].map((i) => attempt(guard, { toolName: 'fetch_page', input: { url: `/p/${i}x` }, callId: `f${i}` }, { html: i }).action);
  assert.deepEqual(actions, ['allow', 'allow', 'block']);
  assert.equal(guard.history()[0].rule, 'max-calls');
});

test('custom escalation and message', () => {
  const guard = createLoopGuard({ escalation: { warn: 3, block: 4, stop: 6 }, message: (v) => `spinstop: custom ${v.rule} ${v.count}` });
  const actions = [1, 2, 3, 4].map((i) => attempt(guard, call(i)));
  assert.deepEqual(actions.map((v) => v.action), ['allow', 'allow', 'warn', 'block']);
  assert.equal(actions[3].message, 'spinstop: custom exact-repeat 4');
});

test('window: repeats older than the window are forgotten', () => {
  const guard = createLoopGuard({ window: 3 });
  attempt(guard, call(1));
  for (let i = 0; i < 3; i++) attempt(guard, { toolName: 'other', input: { i }, callId: `o${i}` }, { i });
  assert.equal(guard.check(call(9)).action, 'allow');
});

test('history is capped by maxHistory', () => {
  const guard = createLoopGuard({ maxHistory: 3, exact: true, escalation: { warn: 2, block: 100, stop: 200 } });
  for (let i = 1; i <= 10; i++) attempt(guard, call(i));
  const h = guard.history();
  assert.equal(h.length, 3);
  assert.equal(h.at(-1).seq, 9);
});

test('LoopDetectedError carries the verdict and history', () => {
  const guard = createLoopGuard();
  let v;
  for (let i = 1; i <= 3; i++) v = attempt(guard, call(i));
  const err = new LoopDetectedError(v, guard.history());
  assert.equal(err.name, 'LoopDetectedError');
  assert.equal(err.verdict.action, 'block');
  assert.match(err.message, /^spinstop: send_email was called 3 times/);
  assert.equal(err.history.length, 2);
});

test('createLoopGuard rejects invalid options with a message naming the field and range', () => {
  const bad = [
    [{ escalation: { warn: 5, block: 2, stop: 1 } }, /escalation must satisfy warn <= block <= stop, got warn 5, block 2, stop 1/],
    [{ escalation: { block: 0 } }, /escalation\.block must be a positive integer/],
    [{ tools: { a: { maxCalls: -1 } } }, /tools\.a\.maxCalls must be a positive integer/],
    [{ window: 0 }, /window must be a positive integer/],
    [{ window: 'x' }, /window must be a positive integer, got "x"/],
    [{ maxHistory: 1.5 }, /maxHistory must be a positive integer/],
    [{ noProgress: { warnAfter: 6, stopAfter: 2 } }, /warnAfter <= stopAfter/],
    [{ near: { maskNumbers: 'yes' } }, /near\.maskNumbers/],
    [{ cycle: { maxPeriod: 0 } }, /cycle\.maxPeriod/],
  ];
  for (const [options, pattern] of bad) assert.throws(() => createLoopGuard(options), (e) => e instanceof TypeError && pattern.test(e.message), JSON.stringify(options));
});

test('valid edge options are still accepted', () => {
  createLoopGuard({ window: 1, escalation: { warn: 1, block: 1, stop: 1 }, tools: { a: { maxCalls: 1 } }, near: false, cycle: false, noProgress: false });
});
