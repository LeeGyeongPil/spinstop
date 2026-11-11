// 공개 타입 모음. 코어는 어떤 에이전트 프레임워크에도 의존하지 않는다.

/** 가드가 판정할 도구 호출 하나. */
export interface ToolCallInfo {
  toolName: string;
  input: unknown;
  /** 프레임워크가 준 호출 ID. 같은 callId 로 다시 record 하면 결과를 채운다. */
  callId?: string;
}

/** 도구 실행(또는 차단) 결과. */
export interface ToolOutcome {
  output?: unknown;
  isError?: boolean;
  /** 가드가 막아서 실제로는 실행되지 않은 호출이면 true. */
  blocked?: boolean;
}

/** 개입 수준: 그대로 실행 → 경고 → 실행하지 않음 → 루프 중단. */
export type Action = 'allow' | 'warn' | 'block' | 'stop';

/** 판정 규칙. 동률일 때는 이 순서의 앞 규칙을 보고한다. */
export type RuleId = 'exact-repeat' | 'near-repeat' | 'cycle' | 'no-progress' | 'max-calls';

export interface Verdict {
  action: Action;
  /** 가장 강한 판정을 낸 규칙(allow 면 없음). */
  rule?: RuleId;
  /** 규칙이 센 수: 반복 횟수, 순환 반복 수, 무진전 step 수, 도구 호출 수. */
  count?: number;
  /** 모델에게 돌려줄 설명. 항상 "spinstop:" 으로 시작한다. */
  message?: string;
  /** 같은 판정에서 warn 이상으로 함께 걸린 다른 규칙. */
  also?: RuleId[];
  /** 호출의 정확 서명(해시). step 끝 판정이면 "step:<n>". */
  signature: string;
}

/** history() 가 돌려주는 개입 기록 하나(JSON 직렬화 가능). */
export interface GuardEvent {
  /** 이벤트 순번(1부터). */
  seq: number;
  /** 몇 번째 step 에서 일어났는지(1부터). */
  step: number;
  /** 'call' = 도구 실행 전 판정, 'step' = step 끝 판정. */
  phase: 'call' | 'step';
  toolName?: string;
  callId?: string;
  action: Exclude<Action, 'allow'>;
  rule: RuleId;
  count: number;
  message: string;
  also?: RuleId[];
  signature: string;
}

/** 도구별 정책. */
export interface ToolPolicy {
  /** 폴링·검증처럼 반복이 정상인 도구. 모든 규칙에서 빠진다(기록은 한다). */
  exempt?: boolean;
  /** 비교에서 뺄 필드 경로(점 표기, 예: "filters.date"). */
  ignore?: string[];
  /** 이 필드만 비교한다(점 표기). ignore 보다 먼저 적용된다. */
  loopKey?: string[];
  /** 이 도구를 이 횟수보다 많이 부르면 block. */
  maxCalls?: number;
  /** false 면 이 도구는 near-repeat 를 보지 않는다. */
  near?: boolean;
}

export interface NearOptions {
  /** 기본 휘발 키(ts, timestamp, nonce …)에 더해 근사 비교에서 지울 키 이름. */
  ignoreKeys?: string[];
  /**
   * 숫자를 "#" 로 가려 근사 비교한다.
   * 'text'(기본): 여러 단어로 된 문자열 속 숫자만 가린다. 숫자 값·주문 번호 같은 식별자는 그대로 비교한다.
   * true: 숫자 값과 모든 문자열 속 숫자를 가린다. false: 가리지 않는다.
   */
  maskNumbers?: boolean | 'text';
  /** 문자열 단어를 정렬해 어순 차이를 지운다(기본 true). */
  tokenSort?: boolean;
}

export interface Escalation {
  warn: number;
  block: number;
  stop: number;
}

export interface LoopGuardOptions {
  /** exact·near 반복을 셀 최근 호출 수(기본 20). */
  window?: number;
  /** exact·near 반복 횟수의 개입 기준(기본 warn 2 / block 3 / stop 5). */
  escalation?: Partial<Escalation>;
  /** false 면 exact-repeat 를 끈다. */
  exact?: boolean;
  /** false 면 near-repeat 를 끈다. */
  near?: false | NearOptions;
  /** false 면 cycle 을 끈다. maxPeriod 기본 4. */
  cycle?: false | { maxPeriod?: number };
  /** false 면 no-progress 를 끈다. 기본 warnAfter 3 / stopAfter 5 step. */
  noProgress?: false | { warnAfter?: number; stopAfter?: number };
  /** 도구 이름별 정책. */
  tools?: Record<string, ToolPolicy>;
  /** 모델에게 돌려줄 메시지를 직접 만든다. */
  message?: (verdict: Verdict, call?: ToolCallInfo) => string;
  /** history() 에 남길 최대 이벤트 수(기본 1000, 넘으면 오래된 것부터 버림). */
  maxHistory?: number;
}

/** 가드 누적 통계. */
export interface GuardStats {
  /** 판정을 거쳐 기록된 호출 수(차단 포함). */
  calls: number;
  /** 실제로 실행된 호출 수(차단 제외). */
  executed: number;
  /** 실행하지 않은(차단된) 호출 수. */
  blocked: number;
  /** 끝난 step 수. */
  steps: number;
  /** stop 에 닿았는지. */
  stopped: boolean;
}

export interface LoopGuard {
  /** 실행 전 판정. 호출 기록에는 넣지 않고, warn 이상이면 history 에 남긴다. stop 은 끈적하다(reset 전까지 유지). */
  check(call: ToolCallInfo): Verdict;
  /** 호출을 기록한다. outcome 이 없으면 "실행 중"으로 두고, 같은 callId 로 다시 부르면 결과를 채운다. */
  record(call: ToolCallInfo, outcome?: ToolOutcome): void;
  /** step 을 닫는다: 순환 판정용 step 서명과 무진전 수를 갱신한다. */
  endStep(): Verdict;
  /** stop 수준에 닿았으면 true. */
  shouldStop(): boolean;
  /** warn·block·stop 기록(JSON 직렬화 가능한 사본). */
  history(): GuardEvent[];
  /** 누적 통계. */
  stats(): GuardStats;
  /** 모든 상태를 지운다(다음 실행에 다시 쓸 때). */
  reset(): void;
}
