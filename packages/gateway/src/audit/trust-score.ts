// Trust-Score Scanner — Council Verdict Phase 3 (Surpass Plan)
// Scans a SKILL.md for network exfiltration, filesystem scope, and
// permission mismatch. Produces a 0–100 trust score with findings.
//
// Usage from CLI:  `aether-audit trust-score ./skills/my-skill.md`

// Minimal structural type so we don't create an import cycle with skill-loader.
interface SkillParserLike {
  parseFromFile(path: string): {
    level1: { name: string; [k: string]: unknown };
    level3?: { code?: string; [k: string]: unknown };
    rawContent: string;
    source: string;
    [k: string]: unknown;
  };
}

export interface TrustScoreFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  detail: string;
  line?: string;
}

export interface TrustScoreReport {
  skillName: string;
  skillPath: string;
  source: string;
  trustScore: number;        // 0-100
  threshold: number;
  allowed: boolean;
  findings: TrustScoreFinding[];
  summary: {
    networkAccess: boolean;
    filesystemWrite: boolean;
    filesystemRead: boolean;
    execDetected: boolean;
    evalDetected: boolean;
    permissionMismatch: boolean;
    deprecatedPatterns: string[];
  };
}

const SEVERITY_PENALTIES = { critical: 40, high: 20, medium: 10, low: 5 };
const DEFAULT_THRESHOLD = 80;

// Patterns that signal a skill may be doing more than it declares.
const DETECTORS: Array<{ type: string; severity: TrustScoreFinding['severity']; pattern: RegExp; detail: string }> = [
  { type: 'eval', severity: 'critical', pattern: /\beval\s*\(/, detail: 'eval() call — arbitrary code execution' },
  { type: 'new_function', severity: 'critical', pattern: /\bnew\s+Function\s*\(/, detail: 'new Function() — dynamic code construction' },
  { type: 'child_process_spawn', severity: 'critical', pattern: /(?:child_process|cp)\.spawn\s*\(/, detail: '*.spawn() — subprocess execution' },
  { type: 'child_process_exec', severity: 'critical', pattern: /(?:child_process|cp)\.exec\s*\(/, detail: '*.exec() — shell execution' },
  { type: 'exec_sync', severity: 'critical', pattern: /\bexecSync\s*\(/, detail: 'execSync() — synchronous shell command' },
  { type: 'http_require', severity: 'high', pattern: /require\s*\(\s*['"]http['"]\s*\)/, detail: 'require("http") — raw network access' },
  { type: 'https_require', severity: 'high', pattern: /require\s*\(\s*['"]https['"]\s*\)/, detail: 'require("https") — raw network access' },
  { type: 'net_require', severity: 'high', pattern: /require\s*\(\s*['"]net['"]\s*\)/, detail: 'require("net") — raw socket access' },
  { type: 'fetch', severity: 'high', pattern: /\bfetch\s*\(/, detail: 'fetch() — network request' },
  { type: 'fs_write', severity: 'high', pattern: /require\s*\(\s*['"]fs['"]\s*\)\.write/i, detail: 'fs.write* — filesystem write' },
  { type: 'write_file_sync', severity: 'high', pattern: /writeFileSync\s*\(/, detail: 'writeFileSync() — filesystem write' },
  { type: 'fs_read', severity: 'medium', pattern: /require\s*\(\s*['"]fs['"]\s*\)(?!\.write)/i, detail: 'fs.* — filesystem read' },
  { type: 'read_file_sync', severity: 'medium', pattern: /readFileSync\s*\(/, detail: 'readFileSync() — filesystem read' },
  { type: 'nested_eval', severity: 'critical', pattern: /\(0,\s*eval\)\s*\(/, detail: 'indirect eval — obfuscated execution' },
  { type: 'vm_run', severity: 'critical', pattern: /vm\.runIn(New)?(Context|ThisContext|Script)/i, detail: 'vm.runIn* — V8 sandbox escape' },
];

export class TrustScoreScanner {
  private parser: SkillParserLike;
  private threshold: number;

  constructor(opts: { parser: SkillParserLike; threshold?: number }) {
    this.parser = opts.parser;
    this.threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  }

  scanFile(skillPath: string): TrustScoreReport {
    const skill = this.parser.parseFromFile(skillPath);
    const content = skill.rawContent;
    const findings: TrustScoreFinding[] = [];

    // Run all detectors.
    for (const det of DETECTORS) {
      const m = content.match(det.pattern);
      if (m) {
        findings.push({
          severity: det.severity,
          type: det.type,
          detail: det.detail,
          line: _lineForMatch(content, m.index ?? 0),
        });
      }
    }

    // Permission mismatch: frontmatter declares restrictions but code violates them.
    const fm = (skill.level1 as unknown as Record<string, unknown>) ?? {};
    const declaredPerms = (fm.permissions ?? {}) as Record<string, unknown>;
    if (declaredPerms.network === false && /\bfetch\s*\(|http|https/.test(content)) {
      findings.push({
        severity: 'medium', type: 'permission_mismatch',
        detail: 'frontmatter declares network:false but code contains network access',
      });
    }
    if (declaredPerms.filesystem === false && /require\s*\(\s*['"]fs['"]\s*\)/.test(content)) {
      findings.push({
        severity: 'medium', type: 'permission_mismatch',
        detail: 'frontmatter declares filesystem:false but code imports fs',
      });
    }

    // Compute penalty.
    const totalPenalty = findings.reduce(
      (sum, f) => sum + (SEVERITY_PENALTIES[f.severity] ?? 0), 0,
    );
    const trustScore = Math.max(0, 100 - totalPenalty);

    return {
      skillName: skill.level1.name,
      skillPath,
      source: skill.source,
      trustScore,
      threshold: this.threshold,
      allowed: trustScore >= this.threshold,
      findings,
      summary: {
        networkAccess: findings.some(f => ['http_require', 'https_require', 'net_require', 'fetch'].includes(f.type)),
        filesystemWrite: findings.some(f => ['fs_write', 'write_file_sync'].includes(f.type)),
        filesystemRead: findings.some(f => ['fs_read', 'read_file_sync'].includes(f.type)),
        execDetected: findings.some(f => ['child_process_spawn', 'child_process_exec', 'exec_sync'].includes(f.type)),
        evalDetected: findings.some(f => ['eval', 'new_function', 'nested_eval', 'vm_run'].includes(f.type)),
        permissionMismatch: findings.some(f => f.type === 'permission_mismatch'),
        deprecatedPatterns: findings.filter(f => f.severity === 'critical').map(f => f.type),
      },
    };
  }
}

function _lineForMatch(content: string, index: number): string {
  const before = content.slice(0, index);
  const lineNum = before.split('\n').length;
  const line = content.split('\n')[lineNum - 1]?.trim().slice(0, 80) ?? '';
  return `L${lineNum}: ${line}`;
}
