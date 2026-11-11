// npm run demo:agents — OpenAI Agents JS 에서 도구 입력 가드레일로 반복 호출을 실행 전에 막는다.
// 목 모델이 같은 search 를 고집한다: 1·2번째 실행 → 3·4번째 reject(실행 안 함) → 5번째 stop 으로 실행 종료.
// stop 이 없으면 maxTurns 까지 돌다가 MaxTurnsExceededError 로 끝난다(원인이 남지 않는다).

import { Agent, MaxTurnsExceededError, run, setTracingDisabled, tool } from '@openai/agents';
import { z } from 'zod';
import { createLoopGuard } from 'spinstop';
import { loopInputGuardrail, recordAgentToolResults } from 'spinstop/openai-agents';
import { AGENTS_MOCK_NOTE, RepeatingAgentsModel } from './mock-models.mjs';

setTracingDisabled(true); // 네트워크로 트레이스를 보내지 않는다

console.log(`spinstop demo:agents (${AGENTS_MOCK_NOTE})`);
console.log('');

async function runOnce(label, guard) {
  let executions = 0;
  const search = tool({
    name: 'search',
    description: 'Search the docs',
    parameters: z.object({ query: z.string() }),
    // 가드가 있으면 inputGuardrails 에 넣는다 — 실행 "전" 판정 지점
    inputGuardrails: guard ? [loopInputGuardrail(guard)] : [],
    execute: async ({ query }) => {
      executions += 1;
      return `no results for "${query}"`;
    },
  });
  const agent = new Agent({
    name: 'docs-agent',
    instructions: 'Answer from the docs.',
    model: new RepeatingAgentsModel({ name: 'search', args: { query: 'rate limit header' } }),
    tools: [search],
  });
  const detach = guard ? recordAgentToolResults(agent, guard) : () => {};

  let ending;
  try {
    await run(agent, 'Which header carries the rate limit?', { maxTurns: 10 });
    ending = 'finished normally';
  } catch (err) {
    ending = err instanceof MaxTurnsExceededError ? `${err.constructor.name} (hit maxTurns 10, no cause recorded)` : `${err.constructor.name} (stopped by spinstop)`;
  } finally {
    detach(); // 리스너 해제
  }
  console.log(`${label}: ${executions} executions, ended with ${ending}`);
}

await runOnce('maxTurns only', undefined);

const guard = createLoopGuard();
await runOnce('spinstop', guard);
console.log('');
console.log('guard.history():');
for (const e of guard.history()) {
  console.log(`  turn ${e.step}: ${e.action.padEnd(5)} ${e.rule} x${e.count} — ${e.message}`);
}
console.log(`stats: ${JSON.stringify(guard.stats())}`);
console.log('');
console.log(`Note: ${AGENTS_MOCK_NOTE}`);
