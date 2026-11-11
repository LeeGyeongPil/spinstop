// AC-5·AC-6: Vercel AI SDK 실제 generateText 루프 + 목 모델(키·네트워크 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateText, isStepCount, jsonSchema, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createLoopGuard, LoopDetectedError } from 'spinstop';
import { guardTools, loopPrepareStep, loopStopWhen, withLoopGuard } from 'spinstop/ai';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

// 매 step 같은 도구 호출(들)을 내고, 받은 prompt·tools 를 기록하는 목 모델
function repeatingModel(callsPerStep = [{ toolName: 'send_email', input: { to: 'team@example.com', subject: 'Weekly report' } }]) {
  const seen = [];
  let n = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      n += 1;
      seen.push({ prompt: options.prompt, tools: (options.tools ?? []).map((t) => t.name) });
      return {
        content: callsPerStep.map((c, i) => ({ type: 'tool-call', toolCallId: `call-${n}-${i}`, toolName: c.toolName, input: JSON.stringify(c.input) })),
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  return { model, seen };
}

function emailTools(counter) {
  return {
    send_email: tool({
      description: 'Send an email',
      inputSchema: jsonSchema({ type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' } } }),
      execute: async () => {
        counter.executions += 1;
        return { status: 'sent' };
      },
    }),
  };
}

test('AC-5: withLoopGuard blocks before execution — execute runs 2 times, 3rd result is a spinstop message, stops on the 5th attempt', async () => {
  const counter = { executions: 0 };
  const guard = createLoopGuard();
  const { model } = repeatingModel();
  const result = await generateText({
    model,
    prompt: 'Send the weekly report.',
    ...withLoopGuard({ tools: emailTools(counter), guard, stopWhen: isStepCount(20) }),
  });

  assert.equal(counter.executions, 2); // 실제 부작용은 두 번뿐
  const third = result.steps[2].toolResults[0].output;
  assert.equal(typeof third, 'string');
  assert.match(third, /^spinstop: send_email was called 3 times/);
  assert.equal(result.steps.length, 5); // 5번째 시도(stop)에서 loopStopWhen 이 끝냄
  assert.ok(result.steps.length < 20);
  assert.equal(guard.shouldStop(), true);
  assert.deepEqual(guard.history().filter((e) => e.phase === 'call').map((e) => e.action), ['warn', 'block', 'block', 'stop']);
  assert.deepEqual(guard.stats(), { calls: 5, executed: 2, blocked: 3, steps: 5, stopped: true });
});

test('AC-6: loopStopWhen alone (post-hoc) stops at step 3 — the 3rd call has already run', async () => {
  const counter = { executions: 0 };
  const guard = createLoopGuard();
  const { model } = repeatingModel();
  const result = await generateText({
    model,
    prompt: 'Send the weekly report.',
    tools: emailTools(counter),
    stopWhen: [isStepCount(20), loopStopWhen(guard)],
  });
  assert.equal(result.steps.length, 3);
  assert.equal(counter.executions, 3); // 사후 판정의 한계
  assert.equal(guard.history().at(-1).action, 'block');
});

test('AC-6: loopPrepareStep appends a [spinstop] user message after a warn', async () => {
  const counter = { executions: 0 };
  const guard = createLoopGuard();
  const { model, seen } = repeatingModel();
  await generateText({
    model,
    prompt: 'Send the weekly report.',
    ...withLoopGuard({ tools: emailTools(counter), guard, stopWhen: isStepCount(20) }),
  });
  // step 2 에서 warn → step 3 의 prompt 끝에 경고가 붙는다
  const warned = seen[2].prompt.at(-1);
  assert.equal(warned.role, 'user');
  assert.match(JSON.stringify(warned.content), /\[spinstop\] spinstop: send_email was called 2 times/);
  // step 2 까지의 prompt 에는 경고가 없다
  assert.ok(!JSON.stringify(seen[1].prompt).includes('[spinstop]'));
});

test('AC-6: loopPrepareStep with warn: false adds nothing', async () => {
  const guard = createLoopGuard();
  const { model, seen } = repeatingModel();
  await generateText({
    model,
    prompt: 'Send.',
    ...withLoopGuard({ tools: emailTools({ executions: 0 }), guard, warn: false }),
  });
  assert.ok(seen.every((s) => !JSON.stringify(s.prompt).includes('[spinstop]')));
});

test('AC-6: narrowTools removes a blocked tool from activeTools for the next step', async () => {
  const guard = createLoopGuard();
  const { model, seen } = repeatingModel();
  const tools = {
    ...emailTools({ executions: 0 }),
    answer: tool({ description: 'Answer', inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => 'ok' }),
  };
  await generateText({ model, prompt: 'Send.', ...withLoopGuard({ tools, guard, narrowTools: true }) });
  // step 3 에서 block → step 4 부터 send_email 이 빠진다
  assert.deepEqual(seen[2].tools.sort(), ['answer', 'send_email']);
  assert.deepEqual(seen[3].tools, ['answer']);
});

test('loopPrepareStep can be used on its own with explicit toolNames', async () => {
  const guard = createLoopGuard();
  const prepare = loopPrepareStep(guard, { narrowTools: true, toolNames: ['send_email', 'answer'] });
  const wrapped = guardTools(emailTools({ executions: 0 }), guard);
  for (let i = 1; i <= 3; i++) await wrapped.send_email.execute({ to: 'a', subject: 'b' }, { toolCallId: `x${i}`, messages: [] });
  const result = await prepare({ steps: [], messages: [{ role: 'user', content: 'hi' }] });
  assert.deepEqual(result.activeTools, ['answer']);
  assert.match(result.messages.at(-1).content, /^\[spinstop\]/);
});

test('parallel identical calls in one step are counted in order (3rd is blocked)', async () => {
  const counter = { executions: 0 };
  const guard = createLoopGuard();
  const same = { toolName: 'send_email', input: { to: 'a@example.com', subject: 's' } };
  const { model } = repeatingModel([same, same, same]);
  const result = await generateText({ model, prompt: 'Send.', tools: guardTools(emailTools(counter), guard), stopWhen: isStepCount(1) });
  assert.equal(counter.executions, 2);
  const outputs = result.steps[0].toolResults.map((r) => r.output);
  assert.equal(outputs.filter((o) => typeof o === 'string' && o.startsWith('spinstop:')).length, 1);
});

test("onBlock: 'throw' turns the block into a tool-error carrying the spinstop message", async () => {
  const guard = createLoopGuard();
  const { model } = repeatingModel();
  const counter = { executions: 0 };
  const result = await generateText({
    model,
    prompt: 'Send.',
    ...withLoopGuard({ tools: emailTools(counter), guard, onBlock: 'throw', stopWhen: isStepCount(3) }),
  });
  assert.equal(counter.executions, 2); // 차단된 3번째 호출은 실제 execute 0회
  const err = result.steps[2].content.find((p) => p.type === 'tool-error');
  assert.ok(err, 'expected a tool-error in step 3');
  assert.ok(err.error instanceof LoopDetectedError);
  assert.match(err.error.message, /^spinstop: /);
});

test('streaming tools (async iterable) pass through and the last chunk is recorded as the result', async () => {
  const guard = createLoopGuard();
  const tools = guardTools(
    {
      progress: tool({
        description: 'Streams progress',
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
        execute: async function* () {
          yield 'working';
          yield 'done';
        },
      }),
    },
    guard,
  );
  const { model } = repeatingModel([{ toolName: 'progress', input: {} }]);
  const result = await generateText({ model, prompt: 'Go.', tools, stopWhen: isStepCount(1) });
  assert.equal(result.steps[0].toolResults[0].output, 'done');
  assert.deepEqual(guard.stats(), { calls: 1, executed: 1, blocked: 0, steps: 0, stopped: false });
});

test('tool errors are recorded; the same failing call is blocked on the 3rd try', async () => {
  let executions = 0;
  const guard = createLoopGuard();
  const tools = {
    write_file: tool({
      description: 'Write a file',
      inputSchema: jsonSchema({ type: 'object', properties: { path: { type: 'string' } } }),
      execute: async () => {
        executions += 1;
        throw new Error('EACCES: permission denied');
      },
    }),
  };
  const { model } = repeatingModel([{ toolName: 'write_file', input: { path: '/srv/fixture/out.txt' } }]);
  const result = await generateText({ model, prompt: 'Write.', ...withLoopGuard({ tools, guard, stopWhen: isStepCount(4) }) });
  assert.equal(executions, 2);
  assert.equal(result.steps[0].content.find((p) => p.type === 'tool-error').error.message, 'EACCES: permission denied');
  assert.match(String(result.steps[2].toolResults[0].output), /^spinstop: write_file was called 3 times/);
});

test('withLoopGuard keeps a user prepareStep and adds a 20-step cap when no stopWhen is given', async () => {
  const guard = createLoopGuard({ exact: false, near: false, cycle: false, noProgress: false });
  const calls = [];
  const { model } = repeatingModel();
  const result = await generateText({
    model,
    prompt: 'Send.',
    ...withLoopGuard({
      tools: emailTools({ executions: 0 }),
      guard,
      prepareStep: ({ stepNumber }) => {
        calls.push(stepNumber);
        return undefined;
      },
    }),
  });
  assert.equal(result.steps.length, 20);
  assert.equal(calls.length, 20);
});

test('execute is never called for a blocked call in either onBlock mode (per call id)', async () => {
  for (const onBlock of ['result', 'throw']) {
    const ran = [];
    const tools = {
      send_email: tool({
        description: 'Send an email',
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
        execute: async (_input, options) => {
          ran.push(options.toolCallId);
          return { status: 'sent' };
        },
      }),
    };
    const guard = createLoopGuard();
    const { model } = repeatingModel();
    await generateText({ model, prompt: 'Send.', ...withLoopGuard({ tools, guard, onBlock, stopWhen: isStepCount(5) }) });
    assert.deepEqual(ran, ['call-1-0', 'call-2-0'], `onBlock ${onBlock}: only steps 1-2 may execute`);
    assert.equal(guard.stats().blocked, 3, onBlock);
  }
});

test('guardTools rejects an unknown onBlock value', () => {
  assert.throws(() => guardTools(emailTools({ executions: 0 }), createLoopGuard(), { onBlock: 'ignore' }), /onBlock must be 'result' or 'throw'/);
});
