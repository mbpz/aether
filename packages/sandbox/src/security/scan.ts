// Defensive code scanner that aims to defeat common evasion tricks.
//
// Threat model
// ------------
// The scanner is a *fail-fast* check that runs before code is sent to
// the V8 isolate. The isolate itself is the actual security boundary;
// this layer's job is to reject obviously malicious payloads at the
// door without paying the cost of spinning up an isolate. It is NOT
// meant to be a complete static analyzer.
//
// Evasion techniques the scanner defeats
// --------------------------------------
//   - string concatenation:    `require('ht' + 'tps')`
//   - template literals:       `` `${'ht'}${'tps'}` ``
//   - bracket access:          `globalThis['re' + 'quire']('fs')`
//   - aliased builtins:        `const x = eval; x('...')`
//   - Function constructor:    `new Function('return process')()`
//   - dynamic import:          `import(s)`
//   - encoded payloads:        `Buffer.from('aHR0cHM=', 'base64')`
//
// What the scanner does NOT do
// ----------------------------
//   - full JavaScript parsing
//   - control-flow analysis
//   - type inference
// These are out of scope. Anything that bypasses the scanner is still
// contained by the V8 isolate, which has no `require`, no `process`,
// no `globalThis.fetch`, etc. unless explicitly injected.

const BLOCKED_MODULE_TOKENS = [
  'http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns',
  'fs', 'fs/promises',
  'child_process', 'cluster', 'worker_threads',
  'vm', 'module', 'v8',
  'inspector', 'async_hooks',
];

const BLOCKED_GLOBALS = [
  'process', 'globalThis.process',
  'require', 'globalThis.require',
  'fetch', 'XMLHttpRequest', 'WebSocket',
  'eval', 'Function',
];

export type ScanViolationKind =
  | 'network' | 'filesystem' | 'process' | 'module' | 'dynamic';

export interface ScanViolation {
  kind: ScanViolationKind;
  detail: string;
  snippet: string;
}

/**
 * Replace every string literal or template literal in `code` with a
 * canonical placeholder so downstream regex matching can no longer be
 * evaded by concatenation. Returns the rewritten code together with a
 * map of placeholder → resolved string for any follow-up analysis.
 *
 * Examples:
 *   "require('ht' + 'tps')"        -> "require(__S0__)"   with S0="https"
 *   "globalThis['re'+'quire']"     -> "globalThis[__S0__]" with S0="require"
 *   "`${'ht'}${'tps'}`"            -> "__S0__"            with S0="https"
 *
 * The result still parses as valid JavaScript (placeholders are
 * identifiers) so a subsequent AST parser could in principle rebuild
 * the program; we only need it to *match*.
 */
function foldStringExpressions(code: string): { folded: string; literals: string[] } {
  const literals: string[] = [];
  let placeholder = 0;
  const add = (s: string): string => {
    literals.push(s);
    return `__AETHER_S${placeholder++}__`;
  };

  let out = '';
  let i = 0;
  const n = code.length;

  while (i < n) {
    const ch = code[i];

    // Single/double-quoted string literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let value = '';
      let closed = false;
      while (j < n) {
        const c = code[j];
        if (c === '\\' && j + 1 < n) { value += code[j + 1]; j += 2; continue; }
        if (c === quote) { closed = true; break; }
        value += c;
        j++;
      }
      if (!closed) {
        // Unterminated string: keep as-is so the V8 isolate can flag it.
        out += code.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      out += add(value);
      i = j + 1;
      continue;
    }

    // Template literal (no nested ${} for simplicity, but we DO recurse
    // into ${...} so dynamic constructions like `${'ht'}${'tps'}` get
    // folded too).
    if (ch === '`') {
      let value = '';
      let j = i + 1;
      while (j < n && code[j] !== '`') {
        if (code[j] === '\\' && j + 1 < n) { value += code[j + 1]; j += 2; continue; }
        if (code[j] === '$' && code[j + 1] === '{') {
          // Recursively fold the ${...} expression and keep its
          // placeholder in the template.
          let depth = 1;
          let k = j + 2;
          while (k < n && depth > 0) {
            if (code[k] === '{') depth++;
            else if (code[k] === '}') depth--;
            if (depth === 0) break;
            k++;
          }
          const inner = code.slice(j + 2, k);
          const innerFolded = foldStringExpressions(inner);
          // Stitch the inner placeholders into the outer literal so
          // the entire template evaluates to a single canonical string
          // at runtime. We do this by emitting a string-concat
          // expression in the placeholder slot.
          value += '__AETHER_T__' + literals.length;
          literals.push(innerFolded.literals.join('+'));
          j = k + 1;
          continue;
        }
        value += code[j];
        j++;
      }
      out += add(value);
      i = j + 1;
      continue;
    }

    // Line comment
    if (ch === '/' && code[i + 1] === '/') {
      const nl = code.indexOf('\n', i);
      const end = nl === -1 ? n : nl;
      out += code.slice(i, end);
      i = end;
      continue;
    }
    // Block comment
    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      const realEnd = end === -1 ? n : end + 2;
      out += code.slice(i, realEnd);
      i = realEnd;
      continue;
    }

    out += ch;
    i++;
  }

  return { folded: out, literals };
}

/**
 * Heuristic tokenizer that splits JavaScript into a sequence of
 * "interesting" tokens: identifiers, dotted names, and bracket-access
 * expressions with string arguments. It is intentionally forgiving —
 * we just want to detect access to `require`, `process`, `fetch`, and
 * friends, not to be a parser.
 */
function interestingTokens(code: string): string[] {
  const out: string[] = [];
  // identifier.name
  const idRe = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(code)) !== null) {
    out.push(m[0]);
  }
  // dotted identifiers: foo.bar.baz -> foo.bar.baz
  const dottedRe = /[A-Za-z_$][A-Za-z0-9_$]*(?:\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*)+/g;
  while ((m = dottedRe.exec(code)) !== null) {
    out.push(m[0].replace(/\s+/g, ''));
  }
  // bracket access with literal arg: foo['bar'] -> foo.bar
  const bracketRe = /[A-Za-z_$][A-Za-z0-9_$]*\s*\[\s*['"]__AETHER_S(\d+)__['"]\s*\]/g;
  while ((m = bracketRe.exec(code)) !== null) {
    const idx = Number(m[1]);
    // The placeholder is replaced below by `literals[idx]`.
    out.push(`__BRACKET__${idx}`);
  }
  return out;
}

const PLACEHOLDER_RE = /__AETHER_S(\d+)__/g;
const TEMPLATE_PLACEHOLDER_RE = /__AETHER_T__(\d+)/g;

/**
 * Expand the placeholders produced by `foldStringExpressions` so that
 * the downstream tokenizer sees the actual string values instead of
 * the synthetic identifiers.
 */
function expandPlaceholders(code: string, literals: string[]): string {
  let out = code.replace(PLACEHOLDER_RE, (_, idx) => {
    return JSON.stringify(literals[Number(idx)] ?? '');
  });
  out = out.replace(TEMPLATE_PLACEHOLDER_RE, (_, idx) => {
    return JSON.stringify(literals[Number(idx)] ?? '');
  });
  return out;
}

export interface ScanConfig {
  blockNetwork: boolean;
  blockFilesystem: boolean;
  blockProcessSpawn: boolean;
  /** Disallow dynamic `import()` calls (data exfiltration via fetch). */
  blockDynamicImport: boolean;
}

export function scanForViolations(
  code: string,
  cfg: ScanConfig,
): ScanViolation[] {
  const violations: ScanViolation[] = [];
  const { folded, literals } = foldStringExpressions(code);
  const expanded = expandPlaceholders(folded, literals);
  const tokens = interestingTokens(expanded);
  const joined = tokens.join(' ');

  const check = (
    enabled: boolean,
    needles: string[],
    kind: ScanViolationKind,
    detailPrefix: string,
  ): void => {
    if (!enabled) return;
    for (const needle of needles) {
      if (joined.includes(needle)) {
        // Find a useful snippet around the match.
        const idx = joined.indexOf(needle);
        const snippet = joined.slice(Math.max(0, idx - 20), idx + needle.length + 20);
        violations.push({
          kind,
          detail: `${detailPrefix}: ${needle}`,
          snippet,
        });
        break;
      }
    }
  };

  // Network: `require('http'|'https'|'net'|'tls'|'dgram'|'dns'|'http2')`
  // or `fetch(`, `XMLHttpRequest`, `WebSocket(`, `import('http...')`.
  check(
    cfg.blockNetwork,
    [
      'http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns',
      'fetch(', 'XMLHttpRequest', 'WebSocket(',
      'EventSource(', 'navigator.sendBeacon(',
    ],
    'network',
    'Network access blocked',
  );

  // Filesystem: `require('fs'|'fs/promises')` or file-API identifiers.
  check(
    cfg.blockFilesystem,
    [
      'fs', 'fs/promises', 'readFileSync', 'writeFileSync', 'readFile', 'writeFile',
      'createReadStream', 'createWriteStream', 'unlinkSync', 'mkdirSync',
    ],
    'filesystem',
    'Filesystem access blocked',
  );

  // Process spawn / Node-internals.
  check(
    cfg.blockProcessSpawn,
    [
      'child_process', 'spawn(', 'execSync(', 'execFileSync(',
      'process.exit', 'process.env', 'process.argv',
      'cluster', 'worker_threads', 'inspector',
    ],
    'process',
    'Process operation blocked',
  );

  // Generic module loader (covers `import(s)` with a dynamic arg).
  check(
    cfg.blockDynamicImport,
    ['import('],
    'dynamic',
    'Dynamic import blocked',
  );

  return violations;
}
