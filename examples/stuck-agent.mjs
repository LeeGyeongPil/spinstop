// npm run demo — 키·네트워크 없이 "실행 전 차단"이 왜 필요한지 실제 도구 실행 횟수로 보여 준다.
// 같은 목 모델을 세 가지 설정으로 돌린다: 단계 상한만 / stopWhen 만(사후 판정) / spinstop 전체.

import { generateText, isStepCount, jsonSchema, tool } from 'ai';
import { createLoopGuard } from 'spinstop';
import { loopStopWhen, withLoopGuard } from 'spinstop/ai';
import { PRACTICE_MOCK_NOTE, scriptedModel } from './mock-models.mjs';

const STEP_CAP = 10;

console.log(`spinstop demo (${PRACTICE_MOCK_NOTE})`);
console.log('');

// ---------------------------------------------------------------------------
// 1부: 같은 메일을 계속 보내려는 에이전트 — 부작용 반복
// ---------------------------------------------------------------------------
function emailSetup() {
  const sent = []; // 실제로 "보낸" 메일(부작용)
  const tools = {
    send_email: tool({
      description: 'Send an email',
      inputSchema: jsonSchema({ type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' } }, required: ['to', 'subject'] }),
      execute: async ({ to, subject }) => {
        sent.push({ to, subject });
        return { status: 'sent' };
      },
    }),
  };
  const model = scriptedModel({
    next: () => ({ toolName: 'send_email', input: { to: 'team@example.com', subject: 'Weekly report' } }),
    switchOnBlock: true,
    finalText: 'The weekly report email was already sent, so I will not send it again.',
  });
  return { sent, tools, model };
}

console.log(`Part 1 — the model keeps sending the same email (step cap ${STEP_CAP})`);

// (a) 단계 상한만: 상한까지 계속 보낸다.
{
  const { sent, tools, model } = emailSetup();
  await generateText({ model, prompt: 'Send the weekly report.', tools, stopWhen: isStepCount(STEP_CAP) });
  console.log(`  step cap only: ${sent.length} executions`);
}

// (b) stopWhen 만: step 이 끝난 뒤 판정하므로 세 번째 메일은 이미 나간 뒤에 멈춘다.
let posthocGuard;
{
  const { sent, tools, model } = emailSetup();
  posthocGuard = createLoopGuard();
  const r = await generateText({ model, prompt: 'Send the weekly report.', tools, stopWhen: [isStepCount(STEP_CAP), loopStopWhen(posthocGuard)] });
  console.log(`  stopWhen only: ${sent.length} executions (stopped after step ${r.steps.length}; the 3rd email had already gone out)`);
}

// (c) spinstop 전체: 세 번째 호출은 실행되지 않고 차단 메시지가 도구 결과로 돌아간다.
let fullGuard;
{
  const { sent, tools, model } = emailSetup();
  fullGuard = createLoopGuard();
  const r = await generateText({
    model,
    prompt: 'Send the weekly report.',
    ...withLoopGuard({ tools, guard: fullGuard, stopWhen: isStepCount(STEP_CAP) }),
  });
  const blocked = r.steps.flatMap((s) => s.toolResults).find((t) => typeof t.output === 'string' && t.output.startsWith('spinstop:'));
  console.log(`  spinstop: ${sent.length} executions (the 3rd call was blocked before it ran)`);
  console.log(`    tool result the model saw: "${blocked?.output}"`);
  console.log(`    model's final answer: "${r.text}"`);
}
console.log('');

// ---------------------------------------------------------------------------
// 2부: 근사 반복 — 타임스탬프·어순·대소문자만 바꾼 검색
// ---------------------------------------------------------------------------
console.log('Part 2 — near-repeat: the same search with a new timestamp and shuffled words each time');
const queries = ['weather seoul', 'Seoul  weather', 'SEOUL weather', 'weather   Seoul'];
function searchSetup() {
  const calls = [];
  const tools = {
    search: tool({
      description: 'Search the web',
      inputSchema: jsonSchema({ type: 'object', properties: { query: { type: 'string' }, ts: { type: 'number' } }, required: ['query'] }),
      execute: async ({ query }) => {
        calls.push(query);
        return { hits: [] }; // 매번 같은 "결과 없음"
      },
    }),
  };
  const model = scriptedModel({
    next: (n) => ({ toolName: 'search', input: { query: queries[(n - 1) % queries.length], ts: 1731300000 + n } }),
    switchOnBlock: true,
    finalText: 'I could not find the weather for Seoul.',
  });
  return { calls, tools, model };
}

for (const [label, options] of [
  ['exact-match guard (near: false)', { near: false }],
  ['spinstop default (near-repeat on)', {}],
]) {
  const { calls, tools, model } = searchSetup();
  const guard = createLoopGuard(options);
  await generateText({ model, prompt: 'Weather in Seoul?', ...withLoopGuard({ tools, guard, stopWhen: isStepCount(STEP_CAP) }) });
  const hit = guard.history().find((e) => e.action === 'block');
  const caught = hit ? `caught by ${hit.rule} at call ${hit.count}` : 'never caught';
  console.log(`  ${label}: ${calls.length} executions, ${caught}`);
}
console.log('');

// ---------------------------------------------------------------------------
// 3부: 오탐 대조 — 결과가 매번 다른 페이지 넘김은 진전이다
// ---------------------------------------------------------------------------
console.log('Part 3 — pagination is progress: list_orders({ page }) returns new orders every time');
{
  let executions = 0;
  const tools = {
    list_orders: tool({
      description: 'List orders, 2 per page',
      inputSchema: jsonSchema({ type: 'object', properties: { page: { type: 'number' } }, required: ['page'] }),
      execute: async ({ page }) => {
        executions += 1;
        return { page, orders: [`order-${page * 2 - 1}`, `order-${page * 2}`] };
      },
    }),
  };
  const model = scriptedModel({ next: (n) => (n <= 6 ? { toolName: 'list_orders', input: { page: n } } : null), finalText: 'Listed 12 orders.' });
  const guard = createLoopGuard();
  await generateText({ model, prompt: 'List all orders.', ...withLoopGuard({ tools, guard, stopWhen: isStepCount(STEP_CAP) }) });
  console.log(`  list_orders pages 1-6: ${executions} executions, ${guard.history().length} interventions`);
}
console.log('');

// ---------------------------------------------------------------------------
// guard.history(): 무엇이 언제 걸렸는지 — 사후 분석·테스트 단언용 JSON
// ---------------------------------------------------------------------------
console.log('guard.history() from the spinstop run in Part 1:');
console.log(JSON.stringify(fullGuard.history().map(({ seq, step, toolName, action, rule, count }) => ({ seq, step, toolName, action, rule, count })), null, 2));
console.log('');
console.log(`stats: ${JSON.stringify(fullGuard.stats())}`);
console.log('');
console.log(`Note: ${PRACTICE_MOCK_NOTE}`);
