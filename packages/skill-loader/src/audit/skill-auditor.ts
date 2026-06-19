import { AuditReport, AuditIssue, AuditConfig, IssueType, IssueSeverity } from './auditor-types.js';

// Re-export types so consumers can import everything from one entry point
export type { AuditReport, AuditIssue, AuditConfig, IssueType, IssueSeverity } from './auditor-types.js';

const SEVERITY_PENALTIES: Record<IssueSeverity, number> = {
  critical: 40,
  high: 20,
  medium: 10,
  low: 5,
};

export class SkillSecurityAuditor {
  private config: Required<AuditConfig>;

  constructor(config: AuditConfig = {}) {
    this.config = {
      threshold: config.threshold ?? 80,
      allowedNetworkHosts: config.allowedNetworkHosts ?? ['localhost', '127.0.0.1'],
    };
  }

  scan(opts: {
    content: string;
    frontmatter: Record<string, unknown>;
    skillId: string;
    skillName: string;
    source: AuditReport['source'];
  }): AuditReport {
    const issues: AuditIssue[] = [];
    issues.push(...this._detectEval(opts.content));
    issues.push(...this._detectSubprocess(opts.content));
    issues.push(...this._detectNetwork(opts.content));
    issues.push(...this._detectFilesystemWrite(opts.content));
    issues.push(...this._detectFilesystemRead(opts.content));
    issues.push(...this._detectPermissionMismatch(opts.content, opts.frontmatter));
    issues.push(...this._detectUnusedPermissions(opts.content, opts.frontmatter));
    const totalPenalty = issues.reduce((sum, issue) => sum + SEVERITY_PENALTIES[issue.severity], 0);
    const trustScore = Math.max(0, 100 - totalPenalty);
    const allowed = trustScore >= this.config.threshold;
    return { skillId: opts.skillId, skillName: opts.skillName, trustScore, allowed, issues, scannedAt: new Date().toISOString(), source: opts.source };
  }

  gate(report: AuditReport): AuditReport {
    return { ...report, allowed: report.trustScore >= this.config.threshold };
  }

  private _detectEval(content: string): AuditIssue[] {
    const issues: AuditIssue[] = [];
    for (const pattern of [/\beval\s*\(/, /new\s+Function\s*\(/, /\(0,\s*eval\)\s*\(/, /vm\.runIn/i]) {
      const match = content.match(pattern);
      if (match) issues.push({ type: 'eval', severity: 'critical', location: this._getLineForMatch(content, match.index!), description: `Suspicious eval pattern: ${match[0]}` });
    }
    return issues;
  }

  private _detectSubprocess(content: string): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const patterns = [
      /child_process\.spawn\s*\(/,
      /child_process\.exec\s*\(/,
      /execSync\s*\(/,
      /\.exec\s*\(/,
      /require\s*\(\s*['"]child_process['"]\s*\)\.spawn/i,
      /require\s*\(\s*['"]child_process['"]\s*\)\.exec/i,
    ];
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) issues.push({ type: 'exec', severity: 'critical', location: this._getLineForMatch(content, match.index!), description: `Subprocess execution: ${match[0]}` });
    }
    return issues;
  }

  private _detectNetwork(content: string): AuditIssue[] {
    const issues: AuditIssue[] = [];
    for (const pattern of [/require\s*\(\s*['"]http['"]\s*\)/, /require\s*\(\s*['"]https['"]\s*\)/, /require\s*\(\s*['"]net['"]\s*\)/, /\bfetch\s*\(/, /XMLHttpRequest/i]) {
      const match = content.match(pattern);
      if (match) issues.push({ type: 'network', severity: 'high', location: this._getLineForMatch(content, match.index!), description: `Network access: ${match[0]}` });
    }
    return issues;
  }

  private _detectFilesystemWrite(content: string): AuditIssue[] {
    const issues: AuditIssue[] = [];
    for (const pattern of [/require\s*\(\s*['"]fs['"]\s*\)\.write/i, /writeFileSync\s*\(/, /createWriteStream\s*\(/]) {
      const match = content.match(pattern);
      if (match) issues.push({ type: 'filesystem', severity: 'high', location: this._getLineForMatch(content, match.index!), description: `Filesystem write: ${match[0]}` });
    }
    return issues;
  }

  private _detectFilesystemRead(content: string): AuditIssue[] {
    const issues: AuditIssue[] = [];
    for (const pattern of [/require\s*\(\s*['"]fs['"]\s*\)\.(?!write)/i, /readFileSync\s*\(/]) {
      const match = content.match(pattern);
      if (match) issues.push({ type: 'filesystem', severity: 'medium', location: this._getLineForMatch(content, match.index!), description: `Filesystem read: ${match[0]}` });
    }
    return issues;
  }

  private _detectPermissionMismatch(content: string, frontmatter: Record<string, unknown>): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const perms = (frontmatter.permissions ?? {}) as Record<string, boolean>;
    const httpRegex = /fetch\s*\(|http|https/;
    if (perms.network === false && httpRegex.test(content)) {
      issues.push({ type: 'permission_mismatch', severity: 'medium', description: 'Network access detected but permissions.network is false' });
    }
    if (perms.filesystem === false && /require\s*\(\s*['"]fs['"]\s*\)/.test(content)) {
      issues.push({ type: 'permission_mismatch', severity: 'medium', description: 'Filesystem access detected but permissions.filesystem is false' });
    }
    return issues;
  }

  private _detectUnusedPermissions(content: string, frontmatter: Record<string, unknown>): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const perms = (frontmatter.permissions ?? {}) as Record<string, boolean>;
    if (perms.exec && !/child_process|spawn|exec|System/i.test(content)) {
      issues.push({ type: 'permission_mismatch', severity: 'low', description: 'permissions.exec declared but no exec patterns found' });
    }
    return issues;
  }

  private _getLineForMatch(content: string, index: number): string {
    const before = content.slice(0, index);
    const lines = before.split('\n');
    return `line ${lines.length}: ${content.slice(index, index + 50).trim()}`;
  }
}