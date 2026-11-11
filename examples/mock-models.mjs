// 키·네트워크 없이 도는 연습용 목(mock) 모델.
// 실제 generateText / run 루프와 실제 도구 실행을 그대로 쓰고, "모델의 선택"만 스크립트로 정한다.
//   - 같은(또는 거의 같은) 도구 호출을 계속 반복한다
//   - switchOnBlock 이면 대화에서 "spinstop:" 차단 메시지를 본 뒤 방향을 바꿔 답을 낸다
// 실제 모델이 차단 메시지를 보고 방향을 바꾸는지는 모델마다 다르다 — 그래서 "practice mock" 이라고 밝힌다.

import { MockLanguageModelV4 } from 'ai/test';
import { Usage } from '@openai/agents';

export const PRACTICE_MOCK_NOTE =
  'practice mock: the model is scripted to repeat itself and to switch tools after it sees a block message — real models may not.';

export const AGENTS_MOCK_NOTE =
  'practice mock: the model is scripted to repeat the same call every turn, even after a block message — real models may change course earlier.';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

// 지금까지의 대화에 spinstop 차단 메시지가 도구 결과(role: tool)로 돌아왔는지.
// (prepareStep 이 덧붙이는 "[spinstop]" 경고는 user 메시지라서 여기서는 세지 않는다 — 목은 경고를 무시하고 고집한다.)
function seesBlock(prompt) {
  return prompt.some((m) => m.role === 'tool' && JSON.stringify(m.content).includes('spinstop:'));
}

function toolCallResponse(id, toolName, input) {
  return {
    content: [{ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: 'tool-calls', raw: undefined },
    usage,
    warnings: [],
  };
}

function textResponse(text) {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: undefined },
    usage,
    warnings: [],
  };
}

/**
 * AI SDK 목 모델. 매 step 에 next(n) 이 돌려준 도구 호출을 한다.
 * next 가 null 을 돌려주면 finalText 로 끝낸다.
 * @param {{ next: (n: number) => ({ toolName: string, input: unknown } | null), switchOnBlock?: boolean, finalText?: string }} script
 */
export function scriptedModel({ next, switchOnBlock = false, finalText = 'Done.' }) {
  let n = 0;
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      n += 1;
      if (switchOnBlock && seesBlock(prompt)) return textResponse(finalText);
      const call = next(n);
      if (!call) return textResponse(finalText);
      return toolCallResponse(`call-${n}`, call.toolName, call.input);
    },
  });
}

/**
 * OpenAI Agents JS 의 Model 인터페이스를 흉내 낸 목. 매 turn 같은 function_call 을 낸다.
 * (차단 메시지를 봐도 고집하는 모델 — stop 수준이 실행을 끝내는 모습을 보여 준다.)
 */
export class RepeatingAgentsModel {
  constructor({ name, args }) {
    this.name = name;
    this.args = args;
    this.turns = 0;
  }

  async getResponse() {
    this.turns += 1;
    return {
      usage: new Usage(),
      output: [
        {
          type: 'function_call',
          callId: `fc-${this.turns}`,
          name: this.name,
          status: 'completed',
          arguments: JSON.stringify(this.args),
        },
      ],
    };
  }

  async *getStreamedResponse() {
    throw new Error('streaming is not used in this practice mock');
  }
}
