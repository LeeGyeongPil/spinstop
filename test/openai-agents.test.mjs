// AC-7: OpenAI Agents JS 실제 run 루프 + 가짜 Model(키·네트워크 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, MaxTurnsExceededError, run, setTracingDisabled, tool } from '@openai/agents';
import { z } from 'zod';
import { createLoopGuard } from 'spinstop';
import { loopInputGuardrail, recordAgentToolResults } from 'spinstop/openai-agents';
import { RepeatingAgentsModel } from '../examples/mock-models.mjs';

setTracingDisabled(true);

function setup(guard, guardrailOptions) {
  const counter = { executions: 0, toolStartEvents: 0 };
  const search = tool({
    name: 'search',
    description: 'Search the docs',
    parameters: z.object({ query: z.string() }),
    inputGuardrails: [loopInputGuardrail(guard, guardrailOptions)],
    execute: async ({ query }) => {
      counter.executions += 1;
      return `no results for ${query}`;
    },
  });
  const model = new RepeatingAgentsModel({ name: 'search', args: { query: 'rate limit header' } });
  const agent = new Agent({ name: 'docs', instructions: 'x', model, tools: [search] });
  agent.on('agent_tool_start', () => {
    counter.toolStartEvents += 1;
  });
  const detach = recordAgentToolResults(agent, guard);
  return { counter, agent, model, detach };
}

test('AC-7: rejects from the 3rd call (2 real executions) and ends with throwException, not MaxTurnsExceededError', async () => {
  const guard = createLoopGuard();
  const { counter, agent, detach } = setup(guard);
  let error;
  try {
    await run(agent, 'Which header carries the rate limit?', { maxTurns: 10 });
  } catch (err) {
    error = err;
  } finally {
    detach();
  }
  assert.ok(error, 'run should end with an error');
  assert.ok(!(error instanceof MaxTurnsExceededError), `got ${error?.constructor?.name}`);
  assert.equal(counter.executions, 2);
  assert.equal(guard.shouldStop(), true);
  const calls = guard.history().filter((e) => e.phase === 'call');
  assert.deepEqual(calls.map((e) => e.action), ['warn', 'block', 'block', 'stop']);
});

test('AC-7: recordAgentToolResults does not count rejected calls as executions', async () => {
  const guard = createLoopGuard();
  const { counter, agent, detach } = setup(guard);
  await run(agent, 'q', { maxTurns: 10 }).catch(() => {});
  detach();
  // agent_tool_start 는 거절된 호출에도 뜬다(관찰 훅은 실행 횟수가 아니다)
  assert.ok(counter.toolStartEvents > counter.executions);
  assert.equal(guard.stats().executed, 2);
  assert.equal(guard.stats().blocked, 3);
});

test("onStop: 'reject' only rejects, so the run eventually hits maxTurns", async () => {
  const guard = createLoopGuard();
  const { counter, agent, detach } = setup(guard, { onStop: 'reject' });
  let error;
  await run(agent, 'q', { maxTurns: 6 }).catch((err) => {
    error = err;
  });
  detach();
  assert.ok(error instanceof MaxTurnsExceededError);
  assert.equal(counter.executions, 2);
});

test('the model sees the reject message as the tool result', async () => {
  const guard = createLoopGuard();
  const { agent, detach, model } = setup(guard);
  const inputs = [];
  const original = model.getResponse.bind(model);
  model.getResponse = async (request) => {
    inputs.push(JSON.stringify(request.input));
    return original(request);
  };
  await run(agent, 'q', { maxTurns: 10 }).catch(() => {});
  detach();
  // 4번째 turn 입력에 3번째 호출의 거절 메시지가 들어 있다
  assert.match(inputs[3], /spinstop: search was called 3 times/);
});

test('detach() removes the result listener', async () => {
  const guard = createLoopGuard();
  const { agent, detach } = setup(guard);
  detach();
  agent.emit('agent_tool_end', {}, { name: 'search' }, 'x', { toolCall: { callId: 'zzz', name: 'search', arguments: '{}' } });
  assert.equal(guard.stats().calls, 0);
  assert.equal(guard.stats().steps, 0);
});
