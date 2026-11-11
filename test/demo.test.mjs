// AC-9: 목 데모가 실제 도구 실행 횟수로 교훈을 재현하고 5초 안에 끝난다(키·네트워크 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function runDemo(file) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8', timeout: 30_000, env: { ...process.env, OPENAI_API_KEY: '' } });
  return { code: r.status, out: r.stdout, err: r.stderr, ms: Date.now() - started };
}

test('AC-9: npm run demo compares step cap / stopWhen / spinstop executions', () => {
  const r = runDemo('examples/stuck-agent.mjs');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /step cap only: 10 executions/);
  assert.match(r.out, /stopWhen only: 3 executions/);
  assert.match(r.out, /spinstop: 2 executions/);
  assert.match(r.out, /practice mock/);
  assert.match(r.out, /exact-match guard \(near: false\): 10 executions, never caught/);
  assert.match(r.out, /spinstop default \(near-repeat on\): 2 executions, caught by near-repeat/);
  assert.match(r.out, /pages 1-6: 6 executions, 0 interventions/);
  assert.ok(r.ms < 5000, `took ${r.ms} ms`);
});

test('npm run demo:agents ends by spinstop instead of maxTurns', () => {
  const r = runDemo('examples/agents-js.mjs');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /maxTurns only: 10 executions, ended with MaxTurnsExceededError/);
  assert.match(r.out, /spinstop: 2 executions, ended with \w+ \(stopped by spinstop\)/);
  assert.match(r.out, /practice mock/);
});
