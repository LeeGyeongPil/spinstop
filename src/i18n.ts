// CLI screen messages (English / Korean) and language resolution.
// Every user-facing CLI string lives in MESSAGES; both columns must have the same keys.
// Not translated on purpose: --format json, action/rule ids, exit codes, guard messages
// sent to the model, and the library's TypeError texts.

export type Lang = 'en' | 'ko';

export interface Messages {
  help: string;
  unknownCommand: (command: string) => string;
  needsTraceFile: string;
  failOnInvalid: string;
  formatInvalid: string;
  langInvalid: (value: string) => string;
  langNeedsValue: string;
  configNotObject: (file: string) => string;
  traceEmpty: string;
  traceUnrecognized: string;
  traceLineNotJson: (line: number) => string;
  traceLineNotRecord: (line: number) => string;
  replayTitle: (file: string) => string;
  formatSteps: string;
  formatJsonl: string;
  summary: (format: string, steps: number, calls: number) => string;
  colStep: string;
  colTool: string;
  colAction: string;
  colRule: string;
  colCount: string;
  colWouldRun: string;
  stepEnd: string;
  yes: string;
  no: string;
  noLoop: string;
  firstLine: (intervention: string, block: string, stop: string) => string;
  atStep: (n: number) => string;
  saved: (saved: number, calls: number) => string;
  messageAt: (step: number, message: string) => string;
}

export const MESSAGES: Record<Lang, Messages> = {
  en: {
    help: `spinstop — stop AI agents from spinning on repeated tool calls

Usage:
  spinstop replay <trace> [--config <file.json>] [--fail-on warn|block|stop] [--format table|json]
  spinstop --help | --version

replay  Feed a recorded run through the loop guard and show, per tool call,
        what spinstop would have done (allow / warn / block / stop).

Trace formats:
  - AI SDK steps:  JSON.stringify(result.steps)  (or a result object with "steps")
  - JSONL records: {"step":1,"toolName":"search","input":{...},"output":...,"isError":false}

Options:
  -c, --config   JSON file with LoopGuardOptions (window, escalation, near, cycle, noProgress, tools)
      --fail-on  exit with code 1 if any call reaches this level (for CI)
      --format   table (default) or json
      --lang     en or ko: screen language (default: SPINSTOP_LANG, then LANG, else en)
`,
    unknownCommand: (c) => `unknown command "${c}"`,
    needsTraceFile: 'replay needs a trace file',
    failOnInvalid: '--fail-on must be warn, block or stop',
    formatInvalid: '--format must be table or json',
    langInvalid: (v) => `--lang must be en or ko (got "${v}")`,
    langNeedsValue: '--lang needs a value: en or ko',
    configNotObject: (f) => `${f}: config must be a JSON object`,
    traceEmpty: 'trace is empty',
    traceUnrecognized: 'unrecognized JSON: expected AI SDK steps (an array of steps or { steps }) or tool-call records',
    traceLineNotJson: (n) => `line ${n}: not valid JSON`,
    traceLineNotRecord: (n) => `line ${n}: expected an object with "toolName"`,
    replayTitle: (f) => `spinstop replay: ${f}`,
    formatSteps: 'AI SDK steps',
    formatJsonl: 'JSONL records',
    summary: (f, s, c) => `${f} · ${s} steps · ${c} tool calls`,
    colStep: 'step',
    colTool: 'tool',
    colAction: 'action',
    colRule: 'rule',
    colCount: 'count',
    colWouldRun: 'would run',
    stepEnd: '(step end)',
    yes: 'yes',
    no: 'no',
    noLoop: 'no loop detected',
    firstLine: (i, b, s) => `first intervention: ${i} · first block: ${b} · stop: ${s}`,
    atStep: (n) => `step ${n}`,
    saved: (s, c) => `saved ${s} of ${c} executions (calls the guard would not have run)`,
    messageAt: (n, m) => `message at step ${n}: ${m}`,
  },
  ko: {
    help: `spinstop — 같은 도구 호출을 되풀이하며 맴도는 AI 에이전트를 멈춥니다

사용법:
  spinstop replay <트레이스> [--config <file.json>] [--fail-on warn|block|stop] [--format table|json]
  spinstop --help | --version

replay  기록된 실행을 루프 가드에 다시 통과시켜, 도구 호출마다
        spinstop 이 무엇을 했을지(allow / warn / block / stop) 보여 줍니다.

트레이스 형식:
  - AI SDK steps:  JSON.stringify(result.steps)  (또는 "steps" 를 가진 결과 객체)
  - JSONL 기록:    {"step":1,"toolName":"search","input":{...},"output":...,"isError":false}

옵션:
  -c, --config   LoopGuardOptions 를 담은 JSON 파일 (window, escalation, near, cycle, noProgress, tools)
      --fail-on  어느 호출이든 이 수준에 닿으면 종료 코드 1 (CI 용)
      --format   table(기본) 또는 json
      --lang     en 또는 ko: 화면 언어 (기본: SPINSTOP_LANG, 다음 LANG, 없으면 en)
`,
    unknownCommand: (c) => `알 수 없는 명령 "${c}"`,
    needsTraceFile: 'replay 에는 트레이스 파일이 필요합니다',
    failOnInvalid: '--fail-on 은 warn, block, stop 중 하나여야 합니다',
    formatInvalid: '--format 은 table 또는 json 이어야 합니다',
    langInvalid: (v) => `--lang 은 en 또는 ko 여야 합니다 (입력: "${v}")`,
    langNeedsValue: '--lang 에는 값이 필요합니다: en 또는 ko',
    configNotObject: (f) => `${f}: 설정은 JSON 객체여야 합니다`,
    traceEmpty: '트레이스가 비어 있습니다',
    traceUnrecognized: '알 수 없는 JSON 형식입니다: AI SDK steps(steps 배열 또는 { steps }) 나 도구 호출 기록이어야 합니다',
    traceLineNotJson: (n) => `${n}번째 줄: 올바른 JSON 이 아닙니다`,
    traceLineNotRecord: (n) => `${n}번째 줄: "toolName" 이 있는 객체여야 합니다`,
    replayTitle: (f) => `spinstop replay: ${f}`,
    formatSteps: 'AI SDK steps',
    formatJsonl: 'JSONL 기록',
    summary: (f, s, c) => `${f} · ${s}개 step · 도구 호출 ${c}회`,
    colStep: 'step',
    colTool: '도구',
    colAction: '조치',
    colRule: '규칙',
    colCount: '횟수',
    colWouldRun: '실행 여부',
    stepEnd: '(step 끝)',
    yes: '예',
    no: '아니오',
    noLoop: '맴도는 호출이 없습니다',
    firstLine: (i, b, s) => `첫 개입: ${i} · 첫 차단: ${b} · 중단: ${s}`,
    atStep: (n) => `step ${n}`,
    saved: (s, c) => `실행 ${c}회 중 ${s}회 절약 (가드가 실행하지 않았을 호출)`,
    messageAt: (n, m) => `step ${n} 의 메시지: ${m}`,
  },
};

/** Normalizes ko, ko-KR, ko_KR, ko_KR.UTF-8 (any case) to 'ko'. Everything else (empty, C, POSIX, en_US, fr, ...) is 'en'. */
export function normalizeLang(value: string | undefined): Lang {
  const v = (value ?? '').trim().toLowerCase();
  return /^ko($|[-_.])/.test(v) ? 'ko' : 'en';
}

/** True when the value is accepted by --lang (en or ko after normalization, e.g. "ko_KR.UTF-8"). */
export function isLangValue(value: string): boolean {
  return /^(ko|en)($|[-_.])/.test(value.trim().toLowerCase());
}

/** Priority: --lang flag > SPINSTOP_LANG > LANG > en. A set-but-unrecognized value falls back to en. */
export function resolveLang(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): Lang {
  if (flag !== undefined) return normalizeLang(flag);
  const fromEnv = env.SPINSTOP_LANG || env.LANG;
  return normalizeLang(fromEnv);
}
