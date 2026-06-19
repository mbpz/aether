// Safe JSON parser that defends against prototype pollution and other
// JSON-borne attacks originating from persistence files (.jsonl, .json).
//
// `__proto__`, `constructor`, and `prototype` keys are stripped from any
// object literal. A reviver also rejects non-JSON-spec values such as
// `undefined` and limits nesting depth to prevent stack-overflow DoS.
//
// This is intentionally a small, dependency-free helper that the rest of
// the skill-loader can `import { safeJsonParse } from './parser/safe-json.js'`.

const MAX_DEPTH = 32;
const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function deepSanitize(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    throw new SyntaxError(`safeJsonParse: nesting depth ${depth} exceeds cap ${MAX_DEPTH}`);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => deepSanitize(v, depth + 1));
  }
  // value is a plain object literal here.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (POLLUTION_KEYS.has(k)) continue;
    out[k] = deepSanitize(v, depth + 1);
  }
  return out;
}

export function safeJsonParse<T = unknown>(text: string): T {
  const raw = JSON.parse(text, (_key, value) => {
    // Reject undefined (which JSON.parse normally converts to null/missing)
    if (value === undefined) return null;
    return value;
  });
  return deepSanitize(raw, 0) as T;
}
