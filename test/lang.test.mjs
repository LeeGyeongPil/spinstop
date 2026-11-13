// 화면 언어(en/ko): 우선순위, 정규화, 번역된 출력, 영어 출력 스냅샷, 문구 표 키 집합.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MESSAGES } from '../dist/i18n.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'spinstop-lang-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

// 언어 변수를 지우고 LANG=C 로 고정한 뒤, 테스트가 원하는 값만 얹는다.
function cli(extraEnv, ...args) {
  const env = { ...process.env };
  for (const key of ['SPINSTOP_LANG', 'LANG', 'LC_ALL']) delete env[key];
  const r = spawnSync(process.execPath, ['dist/cli.js', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...env, LANG: 'C', ...extraEnv },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const PING = 'examples/traces/ping-pong.jsonl';
const STUCK = 'examples/traces/stuck-search.steps.json';

test('--lang ko: Korean table header and summary, same exit codes', () => {
  const r = cli({}, '--lang', 'ko', 'replay', PING);
  assert.equal(r.code, 0);
  assert.match(r.out, /^step {2}도구 {9}조치 {3}규칙 +횟수 {2}실행 여부$/m);
  assert.match(r.out, /첫 개입: step 3 · 첫 차단: step 5 · 중단: step 7/);
  assert.match(r.out, /실행 8회 중 4회 절약/);
  assert.equal(cli({}, 'replay', PING, '--lang', 'ko', '--fail-on', 'block').code, 1);
  assert.match(cli({}, '--lang', 'ko', '--help').out, /사용법:/);
  assert.match(cli({}, '--lang', 'ko', '--version').out, /^\d+\.\d+\.\d+\n$/);
  assert.match(cli({}, '--lang=ko', 'replay', 'examples/traces/pagination-ok.jsonl').out, /맴도는 호출이 없습니다/);
});

test('ko errors are translated; prefix and exit code stay', () => {
  const bad = join(tmp, 'bad-ko.jsonl');
  writeFileSync(bad, '{"toolName":"a"}\nnot json\n');
  const r = cli({}, 'replay', bad, '--lang', 'ko');
  assert.equal(r.code, 2);
  assert.equal(r.err, 'spinstop: 2번째 줄: 올바른 JSON 이 아닙니다\n');
  const u = cli({}, '--lang', 'ko', 'frobnicate');
  assert.equal(u.code, 2);
  assert.match(u.err, /^spinstop: 알 수 없는 명령 "frobnicate"/);
});

test('locale values normalize: ko, ko-KR, ko_KR, ko_KR.UTF-8 are Korean; others English', () => {
  for (const v of ['ko', 'ko-KR', 'ko_KR', 'KO_kr.UTF-8']) {
    assert.match(cli({ SPINSTOP_LANG: v }, 'replay', PING).out, /실행 여부/, v);
  }
  assert.match(cli({ LANG: 'ko_KR.UTF-8' }, 'replay', PING).out, /실행 여부/);
  assert.match(cli({}, '--lang', 'ko_KR.UTF-8', 'replay', PING).out, /실행 여부/);
  for (const v of ['C', 'POSIX', 'en_US.UTF-8', 'kok', 'fr_FR']) {
    assert.match(cli({ LANG: v }, 'replay', PING).out, /would run/, v);
  }
});

test('priority: --lang > SPINSTOP_LANG > LANG (LC_ALL is not read)', () => {
  assert.match(cli({ SPINSTOP_LANG: 'ko', LANG: 'ko_KR.UTF-8' }, '--lang', 'en', 'replay', PING).out, /would run/);
  assert.match(cli({ SPINSTOP_LANG: 'en', LANG: 'ko_KR.UTF-8' }, 'replay', PING).out, /would run/);
  assert.match(cli({ SPINSTOP_LANG: 'ko', LANG: 'en_US.UTF-8' }, 'replay', PING).out, /실행 여부/);
  assert.match(cli({ LC_ALL: 'ko_KR.UTF-8' }, 'replay', PING).out, /would run/);
});

test('--lang with an unknown value or no value exits 2', () => {
  const r = cli({}, '--lang', 'fr', 'replay', PING);
  assert.equal(r.code, 2);
  assert.equal(r.err, 'spinstop: --lang must be en or ko (got "fr")\n');
  assert.equal(cli({}, 'replay', PING, '--lang').code, 2);
  assert.equal(cli({}, 'replay', PING, '--lang', '').code, 2);
});

test('--format json is identical in en and ko', () => {
  const en = cli({}, 'replay', STUCK, '--format', 'json', '--lang', 'en');
  const ko = cli({}, 'replay', STUCK, '--format', 'json', '--lang', 'ko');
  assert.equal(en.code, 0);
  assert.equal(ko.out, en.out);
  assert.equal(JSON.parse(ko.out).calls, 7);
});

test('English output matches the v0.1.0 snapshots byte for byte (help gains only the --lang line)', () => {
  const cases = {
    help: ['--help'],
    unknown: ['frobnicate'],
    'no-file': ['replay'],
    'bad-failon': ['replay', PING, '--fail-on', 'nope'],
    'bad-format': ['replay', PING, '--format', 'xml'],
    'ping-pong': ['replay', PING],
    stuck: ['replay', STUCK, '--fail-on', 'block'],
    ok: ['replay', 'examples/traces/pagination-ok.jsonl'],
    json: ['replay', STUCK, '--format', 'json'],
    empty: ['replay', 'test/fixtures/empty.txt'],
    badjson: ['replay', 'test/fixtures/bad.jsonl'],
    notobj: ['replay', 'test/fixtures/notobj.jsonl'],
    unrec: ['replay', 'test/fixtures/unrec.json'],
    'badcfg-obj': ['replay', PING, '--config', 'test/fixtures/arr.json'],
  };
  for (const [name, args] of Object.entries(cases)) {
    const r = cli({}, ...args);
    const actual = `exit=${r.code}\n--stdout--\n${r.out}--stderr--\n${r.err}`;
    assert.equal(actual, readFileSync(join(root, 'test', 'golden', `${name}.txt`), 'utf8'), name);
  }
  assert.equal(readdirSync(join(root, 'test', 'golden')).length, Object.keys(cases).length);
});

test('message tables: en and ko have the same keys with the same shapes', () => {
  const keys = Object.keys(MESSAGES.en).sort();
  assert.deepEqual(Object.keys(MESSAGES.ko).sort(), keys);
  for (const key of keys) {
    assert.equal(typeof MESSAGES.ko[key], typeof MESSAGES.en[key], key);
    if (typeof MESSAGES.en[key] === 'function') assert.equal(MESSAGES.ko[key].length, MESSAGES.en[key].length, key); // 함수는 인자 개수
    else assert.notEqual(MESSAGES.ko[key], '', key);
  }
});
