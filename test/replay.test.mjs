// AC-8: spinstop replay CLI. 자식 프로세스는 spawnSync 로 돌려 끝날 때까지 기다린다(포트·서버 없음).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateText, isStepCount, jsonSchema, tool } from 'ai';
import { scriptedModel } from '../examples/mock-models.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'spinstop-replay-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

function cli(...args) {
  const r = spawnSync(process.execPath, ['dist/cli.js', ...args], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('AC-8: near-repeat trace shows near-repeat and the first block step, --fail-on block exits 1', () => {
  const r = cli('replay', 'examples/traces/stuck-search.steps.json', '--fail-on', 'block');
  assert.equal(r.code, 1);
  assert.match(r.out, /near-repeat/);
  assert.match(r.out, /first block: step 3/);
  assert.match(r.out, /saved 5 of 7 executions/);
});

test('AC-8: normal pagination trace prints "no loop detected" and exits 0', () => {
  const r = cli('replay', 'examples/traces/pagination-ok.jsonl', '--fail-on', 'block');
  assert.equal(r.code, 0);
  assert.match(r.out, /no loop detected/);
});

test('ping-pong trace: blocked at step 5 with the cycle reported alongside', () => {
  const r = cli('replay', 'examples/traces/ping-pong.jsonl');
  assert.equal(r.code, 0); // --fail-on 이 없으면 0
  assert.match(r.out, /first block: step 5/);
  assert.match(r.out, /cycle/);
});

test('--config changes thresholds; --format json is machine-readable', () => {
  const config = join(tmp, 'loose.json');
  writeFileSync(config, JSON.stringify({ escalation: { warn: 5, block: 8, stop: 10 } }));
  const r = cli('replay', 'examples/traces/stuck-search.steps.json', '--config', config, '--fail-on', 'block', '--format', 'json');
  assert.equal(r.code, 0);
  const json = JSON.parse(r.out);
  assert.equal(json.calls, 7);
  assert.equal(json.firstBlock, undefined);
  assert.equal(json.firstIntervention, 5);
});

test('a full JSON.stringify(result.steps) from generateText can be replayed', async () => {
  const result = await generateText({
    model: scriptedModel({ next: () => ({ toolName: 'send_email', input: { to: 'a@example.com', subject: 'hi' } }) }),
    prompt: 'Send.',
    tools: {
      send_email: tool({ description: 'Send', inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => 'sent' }),
    },
    stopWhen: isStepCount(4),
  });
  const file = join(tmp, 'full.steps.json');
  writeFileSync(file, JSON.stringify(result.steps));
  const r = cli('replay', file, '--fail-on', 'stop');
  assert.equal(r.code, 0);
  assert.match(r.out, /AI SDK steps · 4 steps · 4 tool calls/);
  assert.match(r.out, /first block: step 3/);
});

test('usage errors exit 2, --help and --version exit 0', () => {
  assert.equal(cli('replay').code, 2);
  assert.equal(cli('replay', join(tmp, 'missing.json')).code, 2);
  assert.equal(cli('frobnicate').code, 2);
  const bad = join(tmp, 'bad.jsonl');
  writeFileSync(bad, '{"toolName":"a"}\nnot json\n');
  const r = cli('replay', bad);
  assert.equal(r.code, 2);
  assert.match(r.err, /line 2/);
  assert.equal(cli('replay', 'examples/traces/ping-pong.jsonl', '--fail-on', 'nope').code, 2);
  const help = cli('--help');
  assert.equal(help.code, 0);
  assert.match(help.out, /spinstop replay <trace>/);
  assert.match(cli('--version').out, /^\d+\.\d+\.\d+\n$/);
});

test('replay --config with invalid options exits 2 and names the field', () => {
  const cfg = join(tmp, 'badcfg.json');
  writeFileSync(cfg, '{"window":"x"}');
  const r = cli('replay', 'examples/traces/ping-pong.jsonl', '--config', cfg);
  assert.equal(r.code, 2);
  assert.match(r.err, /^spinstop: window must be a positive integer/);
  writeFileSync(cfg, '{"escalation":{"warn":5,"block":2,"stop":1}}');
  const r2 = cli('replay', 'examples/traces/ping-pong.jsonl', '--config', cfg);
  assert.equal(r2.code, 2);
  assert.match(r2.err, /warn <= block <= stop/);
});
