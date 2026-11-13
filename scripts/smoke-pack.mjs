// npm run check:pack — npm pack 결과를 빈 임시 프로젝트에 설치해 세 진입점 import 와 CLI 를 확인한다.
// 'ai'·'@openai/agents' 는 설치하지 않는다: 어댑터가 런타임에 그 패키지를 부르지 않아야 한다.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// 코어는 런타임 의존성이 없어야 한다.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0, 'dependencies must be empty');

// 로케일 변수를 지워 호스트 언어와 무관하게 영어 도움말을 확인한다
function englishEnv() {
  const env = { ...process.env, LANG: 'C' };
  delete env.SPINSTOP_LANG;
  delete env.LC_ALL;
  delete env.LC_MESSAGES;
  return env;
}

const tmp = mkdtempSync(join(tmpdir(), 'spinstop-pack-'));
try {
  // 1) 패키지 만들기(빌드는 check:pack 이 먼저 했다)
  const packed = JSON.parse(execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', tmp], { cwd: root, encoding: 'utf8' }));
  const { filename, files } = packed[0];
  const paths = files.map((f) => f.path);
  for (const must of ['dist/index.js', 'dist/index.d.ts', 'dist/adapters/ai.js', 'dist/adapters/openai-agents.js', 'dist/cli.js', 'LICENSE', 'package.json']) {
    assert.ok(paths.includes(must), `${must} missing from the package`);
  }
  assert.ok(!paths.some((p) => p.startsWith('test/') || p.startsWith('src/') || p.startsWith('node_modules/')), 'package should not ship test/, src/ or node_modules/');

  // 2) 빈 프로젝트에 설치
  const app = join(tmp, 'app');
  mkdirSync(app);
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'spinstop-smoke', private: true, type: 'module' }));
  execFileSync(npm, ['install', '--no-audit', '--no-fund', '--ignore-scripts', join(tmp, filename)], { cwd: app, stdio: 'pipe' });

  // 3) 세 진입점 ESM import
  writeFileSync(
    join(app, 'check.mjs'),
    [
      "import { createLoopGuard, signature, LoopDetectedError } from 'spinstop';",
      "import { guardTools, loopStopWhen, loopPrepareStep, withLoopGuard } from 'spinstop/ai';",
      "import { loopInputGuardrail, recordAgentToolResults } from 'spinstop/openai-agents';",
      'const g = createLoopGuard();',
      "const fns = [signature, LoopDetectedError, guardTools, loopStopWhen, loopPrepareStep, withLoopGuard, loopInputGuardrail, recordAgentToolResults];",
      "if (fns.some((f) => typeof f !== 'function')) throw new Error('missing export');",
      "if (g.check({ toolName: 't', input: {} }).action !== 'allow') throw new Error('bad verdict');",
      "console.log('imports ok');",
    ].join('\n'),
  );
  const imported = execFileSync(process.execPath, ['check.mjs'], { cwd: app, encoding: 'utf8' });
  assert.match(imported, /imports ok/);

  // 4) bin
  const help = execFileSync(npm, ['exec', '--no', '--', 'spinstop', '--lang', 'en', '--help'], { cwd: app, encoding: 'utf8', env: englishEnv() });
  assert.match(help, /spinstop replay <trace>/);

  console.log(`packed ${filename} (${paths.length} files)`);
  console.log('pack smoke ok');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
