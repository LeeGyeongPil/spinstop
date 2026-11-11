// AC-3: 근사 반복 — 결과가 새롭지 않을 때만 센다. 페이지 넘김은 진전.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoopGuard, signature } from 'spinstop';

function attempt(guard, c, outcome) {
  const v = guard.check(c);
  const blocked = v.action === 'block' || v.action === 'stop';
  guard.record(c, blocked ? { blocked: true } : outcome);
  guard.endStep();
  return v;
}

test('search that only changes ts, word order, spaces and case is blocked on the 3rd call (near-repeat)', () => {
  const guard = createLoopGuard();
  const inputs = [
    { query: 'weather seoul', ts: 1731300001 },
    { query: 'Seoul  weather', ts: 1731300002 },
    { query: 'SEOUL weather', ts: 1731300003 },
  ];
  const verdicts = inputs.map((input, i) => attempt(guard, { toolName: 'search', input, callId: `s${i}` }, { output: { hits: [] } }));
  assert.deepEqual(verdicts.map((v) => v.action), ['allow', 'allow', 'block']);
  assert.equal(verdicts[2].rule, 'near-repeat');
  assert.equal(verdicts[2].count, 3);
  assert.match(verdicts[2].message, /nearly the same arguments/);
});

test('an exact-only guard misses the same near-repeat', () => {
  const guard = createLoopGuard({ near: false });
  const actions = [1, 2, 3, 4, 5].map((n) => attempt(guard, { toolName: 'search', input: { query: n % 2 ? 'weather seoul' : 'Seoul weather', ts: n } }, { output: { hits: [] } }).action);
  assert.deepEqual(actions, ['allow', 'allow', 'allow', 'allow', 'allow']);
});

test('list_orders({ page: n }) x10 with a new result each time never reaches warn', () => {
  const guard = createLoopGuard();
  for (let page = 1; page <= 10; page++) {
    const v = attempt(guard, { toolName: 'list_orders', input: { page }, callId: `l${page}` }, { output: { orders: [`order-${page}`] } });
    assert.equal(v.action, 'allow', `page ${page}`);
  }
  assert.equal(guard.history().length, 0);
  assert.equal(guard.shouldStop(), false);
});

test('pagination that keeps returning the same empty page is caught when numbers are fully masked', () => {
  const guard = createLoopGuard({ near: { maskNumbers: true } });
  const actions = [9, 10, 11].map((page) => attempt(guard, { toolName: 'list_orders', input: { page } }, { output: { orders: [] } }).action);
  assert.deepEqual(actions, ['allow', 'allow', 'block']);
});

test("loopKey: ['query'] compares only the query field", () => {
  const policy = { loopKey: ['query'] };
  assert.equal(
    signature('search', { query: 'rate limit', page: 1, ts: 5 }, policy).exact,
    signature('search', { query: 'rate limit', page: 2, ts: 9 }, policy).exact,
  );
  const guard = createLoopGuard({ tools: { search: policy } });
  const a = attempt(guard, { toolName: 'search', input: { query: 'rate limit', page: 1 } }, { output: ['a'] });
  const b = attempt(guard, { toolName: 'search', input: { query: 'rate limit', page: 2 } }, { output: ['b'] });
  assert.equal(a.action, 'allow');
  assert.equal(b.action, 'warn');
  assert.equal(b.rule, 'exact-repeat');

  // 정책이 없으면 page 가 다르니 다른 호출이다
  const plain = createLoopGuard();
  attempt(plain, { toolName: 'search', input: { query: 'rate limit', page: 1 } }, { output: ['a'] });
  assert.equal(attempt(plain, { toolName: 'search', input: { query: 'rate limit', page: 2 } }, { output: ['b'] }).action, 'allow');
});

test('tool policy near: false turns near-repeat off for that tool only', () => {
  const guard = createLoopGuard({ tools: { search: { near: false } } });
  const actions = [1, 2, 3].map((n) => attempt(guard, { toolName: 'search', input: { query: 'x', ts: n } }, { output: 'none' }).action);
  assert.deepEqual(actions, ['allow', 'allow', 'allow']);
});

test('results still pending (parallel calls) are not counted as stale', () => {
  const guard = createLoopGuard();
  // 같은 step 에서 페이지 3개를 병렬로: 결과가 아직 없으니 near 로는 세지 않는다
  for (let page = 1; page <= 3; page++) {
    const c = { toolName: 'list_orders', input: { page }, callId: `p${page}` };
    assert.equal(guard.check(c).action, 'allow');
    guard.record(c);
  }
});

// Q-1 회귀: 서로 다른 식별자로 같은 결과를 받는 정상 배치 작업은 기본 설정에서 막히지 않는다.
function runBatch(inputs, outcome, toolName = 'check_status', options) {
  const guard = createLoopGuard(options);
  const actions = inputs.map((input, i) => attempt(guard, { toolName, input, callId: `b${i}` }, outcome).action);
  return { actions, guard };
}

test('checking 5 different numeric order IDs that all return "shipped" is never blocked or stopped', () => {
  const { actions, guard } = runBatch([101, 102, 103, 104, 105].map((orderId) => ({ orderId })), { output: 'shipped' });
  assert.deepEqual(actions, ['allow', 'allow', 'allow', 'allow', 'allow']);
  assert.equal(guard.shouldStop(), false);
});

test('different string IDs and split file names with the same result are never blocked', () => {
  assert.deepEqual(runBatch(['A-101', 'A-102', 'A-103', 'A-104', 'A-105'].map((orderId) => ({ orderId })), { output: 'shipped' }).actions, Array(5).fill('allow'));
  assert.deepEqual(runBatch([1, 2, 3, 4].map((n) => ({ path: `logs/part-${n}.txt` })), { output: '' }, 'read_file').actions, Array(4).fill('allow'));
});

test('different IDs that each fail with the same error are not counted as a loop', () => {
  const { actions } = runBatch([1, 2, 3, 4].map((id) => ({ id })), { isError: true, output: new Error('Not found') }, 'get_user');
  assert.ok(!actions.includes('block') && !actions.includes('stop'), actions.join(','));
});

test('a query that only changes the number inside the sentence is still a near-repeat', () => {
  const { actions } = runBatch([1, 2, 3].map((n) => ({ query: `latest news number ${n}` })), { output: [] }, 'search');
  assert.deepEqual(actions, ['allow', 'allow', 'block']);
});
