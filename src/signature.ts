// 결정적 서명: "같은 호출"이 무엇인지 정하는 곳.
// - exact: 키 순서·undefined 키 차이만 지운 정확 비교
// - near : 휘발 키·숫자·대소문자·공백·어순까지 지운 근사 비교
// 정보가 사라지는 값(NaN·함수·심볼·순환 참조)은 호출마다 고유 표식을 붙여 "같지 않음"으로 둔다.

import type { NearOptions, ToolOutcome, ToolPolicy } from './types.js';

/** 근사 비교에서 기본으로 지우는 휘발 키(대소문자 무시). */
export const VOLATILE_KEYS = ['ts', 'timestamp', 'time', 'nonce', 'requestId', 'request_id', 'idempotencyKey'];

interface NearConfig {
  dropKeys: Set<string>;
  /** true: 모든 숫자 가림 · 'text': 여러 단어 문장 속 숫자만 · false: 가리지 않음 */
  maskNumbers: boolean | 'text';
  tokenSort: boolean;
}

// 손실 값마다 새 번호를 붙여, 두 호출이 우연히 같아지지 않게 한다.
let uniqueCounter = 0;
function unique(kind: string): string {
  uniqueCounter += 1;
  return `{"$unique":"${kind}#${uniqueCounter}"}`;
}

/** 값 하나를 결정적인 JSON 비슷한 문자열로 바꾼다(exact 비교용). */
export function canonicalize(value: unknown): string {
  return walk(value, new Set(), null);
}

function walk(value: unknown, stack: Set<object>, near: NearConfig | null): string {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(near ? normalizeText(value, near) : value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (Number.isNaN(value)) return unique('NaN');
      if (near?.maskNumbers === true) return '"#"';
      if (!Number.isFinite(value)) return value > 0 ? '{"$num":"Infinity"}' : '{"$num":"-Infinity"}';
      return Object.is(value, -0) ? '0' : String(value);
    case 'bigint':
      return near?.maskNumbers === true ? '"#"' : `{"$bigint":"${value.toString()}"}`;
    case 'undefined':
      return '{"$undefined":true}';
    case 'function':
    case 'symbol':
      return unique(typeof value);
  }
  if (value === null) return 'null';

  const obj = value as object;
  // 조상 경로에 이미 있으면 순환 참조 — 같은 값으로 볼 근거가 없으니 고유 표식.
  if (stack.has(obj)) return unique('cycle');
  stack.add(obj);
  try {
    if (Array.isArray(obj)) {
      return '[' + obj.map((item) => walk(item, stack, near)).join(',') + ']';
    }
    if (obj instanceof Date) {
      if (Number.isNaN(obj.getTime())) return unique('invalid-date');
      return near?.maskNumbers === true ? '{"$date":"#"}' : `{"$date":${JSON.stringify(obj.toISOString())}}`;
    }
    if (obj instanceof Map) {
      // Map 은 넣은 순서와 무관하게 키 서명 순으로 정렬한다.
      const pairs = [...obj.entries()].map(([k, v]) => `[${walk(k, stack, near)},${walk(v, stack, near)}]`);
      return '{"$map":[' + pairs.sort().join(',') + ']}';
    }
    if (obj instanceof Set) {
      const items = [...obj.values()].map((v) => walk(v, stack, near));
      return '{"$set":[' + items.sort().join(',') + ']}';
    }
    if (ArrayBuffer.isView(obj)) {
      const bytes = new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength);
      let hex = '';
      for (const b of bytes) hex += b.toString(16).padStart(2, '0');
      return `{"$bytes":"${hex}"}`;
    }
    if (obj instanceof RegExp) return `{"$regexp":${JSON.stringify(String(obj))}}`;
    if (obj instanceof Error) {
      return `{"$error":${JSON.stringify(obj.name)},"message":${walk(obj.message, stack, near)}}`;
    }
    const withToJSON = obj as { toJSON?: () => unknown };
    if (typeof withToJSON.toJSON === 'function') {
      const json = withToJSON.toJSON();
      if (json !== obj) return walk(json, stack, near);
    }

    // 일반 객체: undefined 키는 없는 키와 같게, 키는 정렬해서.
    const record = obj as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .filter((k) => !near || !near.dropKeys.has(k.toLowerCase()))
      .sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + walk(record[k], stack, near)).join(',') + '}';
  } finally {
    stack.delete(obj);
  }
}

/** 근사 비교용 문자열 정리: 소문자 → 숫자 가림 → 공백 정리 → 단어 정렬. */
function normalizeText(text: string, near: NearConfig): string {
  let s = text.toLowerCase();
  s = s.replace(/\s+/g, ' ').trim();
  // 'text' 모드: 공백이 있는 문장(검색어 등)의 숫자만 가린다. 주문 번호·파일명 같은 식별자는 그대로 둔다.
  if (near.maskNumbers === true || (near.maskNumbers === 'text' && s.includes(' '))) s = s.replace(/\d+/g, '#');
  if (near.tokenSort && s.includes(' ')) s = s.split(' ').sort().join(' ');
  return s;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function getPath(obj: Record<string, unknown>, path: string[]): { found: boolean; value?: unknown } {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isPlainObject(cur) || !(key in cur)) return { found: false };
    cur = cur[key];
  }
  return { found: true, value: cur };
}

function setPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur = obj;
  for (const key of path.slice(0, -1)) {
    if (!isPlainObject(cur[key])) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[path[path.length - 1]!] = value;
}

// 원본을 건드리지 않도록 경로를 따라 얕은 사본을 만들며 지운다.
function omitPath(obj: Record<string, unknown>, path: string[]): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined || !(head in obj)) return obj;
  const copy = { ...obj };
  if (rest.length === 0) {
    delete copy[head];
  } else if (isPlainObject(copy[head])) {
    copy[head] = omitPath(copy[head] as Record<string, unknown>, rest);
  }
  return copy;
}

/** 도구 정책(loopKey → ignore)을 입력에 적용한다. 입력이 객체가 아니면 그대로. */
export function applyPolicy(input: unknown, policy?: ToolPolicy): unknown {
  if (!policy || !isPlainObject(input)) return input;
  let out: Record<string, unknown> = input;
  if (policy.loopKey && policy.loopKey.length > 0) {
    const picked: Record<string, unknown> = {};
    for (const p of policy.loopKey) {
      const path = p.split('.');
      const got = getPath(input, path);
      if (got.found) setPath(picked, path, got.value);
    }
    out = picked;
  }
  for (const p of policy.ignore ?? []) out = omitPath(out, p.split('.'));
  return out;
}

function nearConfig(options?: NearOptions): NearConfig {
  const keys = [...VOLATILE_KEYS, ...(options?.ignoreKeys ?? [])].map((k) => k.toLowerCase());
  return {
    dropKeys: new Set(keys),
    maskNumbers: options?.maskNumbers ?? 'text',
    tokenSort: options?.tokenSort ?? true,
  };
}

/**
 * 도구 호출 서명. exact 는 정확 비교, near 는 근사 비교용 문자열이다.
 * 같은 문자열이면 같은 호출로 본다.
 */
export function signature(
  toolName: string,
  input: unknown,
  policy?: ToolPolicy,
  nearOptions?: NearOptions,
): { exact: string; near: string } {
  const scoped = applyPolicy(input, policy);
  return {
    exact: `${toolName}:${walk(scoped, new Set(), null)}`,
    near: `${toolName}~${walk(scoped, new Set(), nearConfig(nearOptions))}`,
  };
}

/** 오류 값을 비교 가능한 글자로: Error 면 "이름: 메시지". */
export function errorText(error: unknown): unknown {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return error;
}

/**
 * 결과 서명. 오류는 isError 와 메시지까지 넣어 "같은 오류의 반복"을 잡을 수 있게 한다.
 * 결과가 아직 없으면 "pending", 가드가 막았으면 "blocked".
 */
export function resultSignature(outcome?: ToolOutcome): string {
  if (!outcome) return 'pending';
  if (outcome.blocked) return 'blocked';
  if (outcome.isError) return 'error:' + canonicalize(errorText(outcome.output));
  return 'ok:' + canonicalize(outcome.output);
}

/** 짧은 결정적 해시(cyrb53). 긴 서명을 메모리에 그대로 쌓지 않으려고 쓴다. */
export function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}
