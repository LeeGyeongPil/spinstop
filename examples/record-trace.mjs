// examples/traces/stuck-search.steps.json 을 다시 만드는 스크립트(가드 없이 돌린 목 실행의 result.steps).
// 자기 에이전트에서도 같은 방법으로 저장해 `spinstop replay` 에 넣으면 된다:
//   writeFileSync('run.steps.json', JSON.stringify(result.steps))
//
// 사용: node examples/record-trace.mjs [출력 파일]

import { writeFileSync } from 'node:fs';
import { generateText, isStepCount, jsonSchema, tool } from 'ai';
import { scriptedModel } from './mock-models.mjs';

const out = process.argv[2] ?? 'examples/traces/stuck-search.steps.json';
const queries = ['weather seoul', 'Seoul  weather', 'SEOUL weather', 'weather   Seoul'];

const result = await generateText({
  model: scriptedModel({
    next: (n) => ({ toolName: 'search', input: { query: queries[(n - 1) % queries.length], ts: 1731300000 + n } }),
  }),
  prompt: 'Weather in Seoul?',
  tools: {
    search: tool({
      description: 'Search the web',
      inputSchema: jsonSchema({ type: 'object', properties: { query: { type: 'string' }, ts: { type: 'number' } }, required: ['query'] }),
      execute: async () => ({ hits: [] }),
    }),
  },
  stopWhen: isStepCount(7), // 가드 없이 상한까지
});

// 저장 파일을 작게 유지하려고 replay 가 읽는 필드만 남긴다(전체 result.steps 도 그대로 읽힌다).
const steps = result.steps.map((s) => ({ stepNumber: s.stepNumber, content: s.content, finishReason: s.finishReason }));
writeFileSync(out, JSON.stringify(steps, null, 2) + '\n');
console.log(`wrote ${steps.length} steps to ${out}`);
