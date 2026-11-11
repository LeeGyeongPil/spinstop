// AC-1: 결정적 서명 — 키 순서·undefined·Map/Set 순서는 무시하고, 정보가 사라지는 값은 같지 않게.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signature, resultSignature, canonicalize } from 'spinstop';

const sig = (input, policy) => signature('tool', input, policy).exact;

test('key order does not matter', () => {
  assert.equal(sig({ a: 1, b: { c: 2, d: 3 } }), sig({ b: { d: 3, c: 2 }, a: 1 }));
});

test('{ a: undefined } is the same as {}', () => {
  assert.equal(sig({ a: undefined }), sig({}));
  assert.equal(sig({ x: 1, a: undefined }), sig({ x: 1 }));
});

test('Map entries are compared regardless of insertion order', () => {
  const m1 = new Map([['x', 1], ['y', 2]]);
  const m2 = new Map([['y', 2], ['x', 1]]);
  assert.equal(sig({ m: m1 }), sig({ m: m2 }));
  assert.notEqual(sig({ m: m1 }), sig({ m: new Map([['x', 1]]) }));
});

test('Set items are compared regardless of insertion order', () => {
  assert.equal(sig({ s: new Set([1, 2, 3]) }), sig({ s: new Set([3, 1, 2]) }));
  assert.notEqual(sig({ s: new Set([1, 2]) }), sig({ s: [1, 2] }));
});

test('NaN arguments are never equal (lossy value gets a unique marker)', () => {
  assert.notEqual(sig({ n: NaN }), sig({ n: NaN }));
});

test('function and symbol arguments are never equal', () => {
  const fn = () => 1;
  assert.notEqual(sig({ f: fn }), sig({ f: fn }));
  const s = Symbol('x');
  assert.notEqual(sig({ s }), sig({ s }));
});

test('circular references are never equal, shared (non-circular) references are fine', () => {
  const a = { name: 'a' };
  a.self = a;
  const b = { name: 'a' };
  b.self = b;
  assert.notEqual(sig(a), sig(b));
  const shared = { k: 1 };
  assert.equal(sig({ x: shared, y: shared }), sig({ x: { k: 1 }, y: { k: 1 } }));
});

test('BigInt, Date, -0 and typed arrays are serialized deterministically', () => {
  assert.equal(sig({ n: 10n }), sig({ n: 10n }));
  assert.notEqual(sig({ n: 10n }), sig({ n: '10' }));
  assert.equal(sig({ d: new Date('2026-01-01T00:00:00Z') }), sig({ d: new Date('2026-01-01T00:00:00Z') }));
  assert.equal(sig({ z: -0 }), sig({ z: 0 }));
  assert.equal(sig({ b: new Uint8Array([1, 2]) }), sig({ b: new Uint8Array([1, 2]) }));
  assert.notEqual(sig({ b: new Uint8Array([1, 2]) }), sig({ b: new Uint8Array([2, 1]) }));
});

test('array order still matters', () => {
  assert.notEqual(sig({ a: [1, 2] }), sig({ a: [2, 1] }));
});

test('error results include the message, and differ from a normal result', () => {
  const e1 = resultSignature({ isError: true, output: new Error('permission denied') });
  const e2 = resultSignature({ isError: true, output: new Error('permission denied') });
  const e3 = resultSignature({ isError: true, output: new Error('not found') });
  assert.equal(e1, e2);
  assert.notEqual(e1, e3);
  assert.notEqual(resultSignature({ isError: true, output: 'boom' }), resultSignature({ output: 'boom' }));
  assert.match(e1, /permission denied/);
});

test('near signature drops volatile keys and normalizes case, spaces, word order and numbers', () => {
  const a = signature('search', { query: 'weather seoul', ts: 1731300001 });
  const b = signature('search', { query: 'Seoul   weather', ts: 1731300002, requestId: 'r-9' });
  assert.notEqual(a.exact, b.exact);
  assert.equal(a.near, b.near);
  // 기본('text'): 문장 속 숫자만 가리고, 숫자 값·식별자는 그대로 비교한다
  assert.equal(signature('search', { query: 'top 10 results' }).near, signature('search', { query: 'top 20 results' }).near);
  assert.notEqual(signature('list', { page: 1 }).near, signature('list', { page: 2 }).near);
  assert.notEqual(signature('check_status', { orderId: 101 }).near, signature('check_status', { orderId: 102 }).near);
  assert.notEqual(signature('check_status', { orderId: 'A-101' }).near, signature('check_status', { orderId: 'A-102' }).near);
  // maskNumbers: true 면 모든 숫자를 가린다, false 면 문장 속 숫자도 그대로 둔다
  assert.equal(signature('list', { page: 1 }, undefined, { maskNumbers: true }).near, signature('list', { page: 2 }, undefined, { maskNumbers: true }).near);
  assert.notEqual(signature('search', { query: 'top 10 results' }, undefined, { maskNumbers: false }).near, signature('search', { query: 'top 20 results' }, undefined, { maskNumbers: false }).near);
});

test('tool policy: loopKey keeps only the listed paths, ignore removes paths, input is not mutated', () => {
  const input = { query: 'x', page: 3, filters: { date: '2026-11-11', kind: 'a' } };
  const copy = structuredClone(input);
  assert.equal(sig(input, { loopKey: ['query'] }), sig({ query: 'x', page: 9 }, { loopKey: ['query'] }));
  assert.equal(sig(input, { ignore: ['filters.date', 'page'] }), sig({ query: 'x', filters: { kind: 'a' } }));
  assert.deepEqual(input, copy);
});

test('canonicalize is stable text', () => {
  assert.equal(canonicalize({ b: 1, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":1}');
});
