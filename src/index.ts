// spinstop 코어: 프레임워크와 무관하고 런타임 의존성이 없다.
export { createLoopGuard, DEFAULTS } from './guard.js';
export { signature, resultSignature, canonicalize, VOLATILE_KEYS } from './signature.js';
export { LoopDetectedError } from './errors.js';
export type {
  Action,
  Escalation,
  GuardEvent,
  GuardStats,
  LoopGuard,
  LoopGuardOptions,
  NearOptions,
  RuleId,
  ToolCallInfo,
  ToolOutcome,
  ToolPolicy,
  Verdict,
} from './types.js';
