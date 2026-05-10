# Skill Security Audit Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `SkillSecurityAuditor` with static analysis, scoring, three integration points (registry/CLI/API). Score < 80 blocks skill from loading/execution.

**Architecture:** `SkillSecurityAuditor` class in `skill-loader`. Core `scan()` method runs regex patterns on content + frontmatter. `gate()` applies threshold. Three integrations: registry auto-audit, CLI command, API endpoint.

**Tech Stack:** TypeScript, Node.js `fs`/`path`/`crypto`, regex static analysis, Express router (existing), Vitest (existing).

---

## File Structure

| File | Purpose |
|------|---------|
| Create: `packages/skill-loader/src/audit/auditor-types.ts` | `AuditReport`, `AuditIssue`, `AuditConfig` interfaces |
| Create: `packages/skill-loader/src/audit/skill-auditor.ts` | `SkillSecurityAuditor` class — scan + gate |
| Create: `packages/skill-loader/src/audit/skill-auditor.test.ts` | Unit tests for scoring and issue detection |
| Modify: `packages/skill-loader/src/registry/registry.ts` | Inject auditor, gate `register()`, add `auditSkill()`/`auditAll()` |
| Create: `packages/gateway/src/routes/skill-audit.ts` | Express router for `POST /api/skill/audit` |
| Modify: `packages/gateway/src/server.ts` | Mount skill-audit router |
| Create: `packages/skill-loader/bin/skill-audit.js` | CLI executable |

---

## Task 1: Create `auditor-types.ts`

**Files:**
- Create: `packages/skill-loader/src/audit/auditor-types.ts`

- [ ] **Step 1: Write types**

```typescript
export type IssueType = 'network' | 'filesystem' | 'exec' | 'eval' | 'secrets' | 'permission_mismatch';
export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface AuditIssue {
  type: IssueType;
  severity: IssueSeverity;
  location?: string;
  description: string;
}

export interface AuditReport {
  skillId: string;
  skillName: string;
  trustScore: number;
  allowed: boolean;
  issues: AuditIssue[];
  scannedAt: string;
  source: 'manus' | 'openclaw' | 'aether' | 'skillpack' | 'unknown';
}

export interface AuditConfig {
  threshold?: number;
  allowedNetworkHosts?: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/skill-loader/src/audit/auditor-types.ts
git commit -m "types: add SkillSecurityAuditor types (AuditReport, AuditIssue)"
```

---

## Task 2: Create `SkillSecurityAuditor` class

**Files:**
- Create: `packages/skill-loader/src/audit/skill-auditor.ts`
- Test: `packages/skill-loader/src/audit/skill-auditor.test.ts`

- [ ] **Step 1: Write SkillSecurityAuditor class**

```typescript
import { AuditReport, AuditIssue, AuditConfig, IssueType, IssueSeverity } from './auditor-types.js';

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

  /**
   * Static scan of skill content and frontmatter.
   * Returns AuditReport with trust score and issue list.
   */
  scan(opts: {
    content: string;
    frontmatter: Record<string, unknown>;
    skillId: string;
    skillName: string;
    source: AuditReport['source'];
  }): AuditReport {
    const issues: AuditIssue[] = [];

    // 1. Critical patterns (eval, subprocess)
    issues.push(...this._detectEval(opts.content));
    issues.push(...this._detectSubprocess(opts.content));

    // 2. High patterns (network, filesystem write)
    issues.push(...this._detectNetwork(opts.content));
    issues.push(...this._detectFilesystemWrite(opts.content));

    // 3. Medium patterns (filesystem read, permission mismatch)
    issues.push(...this._detectFilesystemRead(opts.content));
    issues.push(...this._detectPermissionMismatch(opts.content, opts.frontmatter));

    // 4. Low patterns (unused declared permissions)
    issues.push(...this._detectUnusedPermissions(opts.content, opts.frontmatter));

    // Compute score
    const totalPenalty = issues.reduce((sum, issue) => sum + SEVERITY_PENALTIES[issue.severity], 0);
    const trustScore = Math.max(0, 100 - totalPenalty);
    const allowed = trustScore >= this.config.threshold;

    return {
      skillId: opts.skillId,
      skillName: opts.skillName,
      trustScore,
      allowed,
      issues,
      scannedAt: new Date().toISOString(),
      source: opts.source,
    };
  }

  /**
   * Apply threshold gate to a report. Returns same report with allowed field.
   */
  gate(report: AuditReport): AuditReport {
    return { ...report, allowed: report.trustScore >= this.config.threshold };
  }

  private _detectEval(content: string): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const patterns = [
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
      /\(0,\s*eval\)\s*\(/,
      /vm\.runIn/i,
    ];
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const line = this._getLineForMatch(content, match.index!);
        issues.push({ type: 'eval', severity: 'critical', location: line, description: `Suspicious eval pattern: ${match[0]}` });
      }
    }
    return issues;
  }

  private _detectSubprocess(content: string): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const patterns = [
      /child_process\.spawn\s*\(/,
      /child_process\.exec\s*\(/,
      /execSync\s*\(/,
      /\.exec\s*\(\s*['"`]/,
    ];
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const line = this._getLineForMatch(content, match.index!);
        issues.push({ type: 'exec', severity: 'critical', location: line, description: `Subprocess execution: ${match[0]}` });
      }
    }
    return issues;
  }

  private _detectNetwork(content: string): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const patterns = [
      /require\s*\(\s*['"]http['"]\s*\)/,
      /require\s*\(\s*['"]https['"]\s*\)/,
      /require\s*\(\s*['"]net['"]\s*\)/,
      /\bfetch\s*\(/,
      /XMLHttpRequest/i,
    ];
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const line = this._getLineForMatch(content, match.index!);
        issues.push({ type: 'network', severity: 'high', location: line, description: `Network access: ${match[0]}` });
      }
    }
    return issues;
  }

  private _detectFilesystemWrite(content: string): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const patterns = [
      /require\s*\(\s*['"]fs['"]\s*\)\.write/i,
      /writeFileSync\s*\(/,
      /createWriteStream\s*\(/,
    ];
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const line = this._getLineForMatch(content, match.index!);
        issues.push({ type: 'filesystem', severity: 'high', location: line, description: `Filesystem write: ${match[0]}` });
      }
    }
    return issues;
  }

  private _detectFilesystemRead(content: string): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const patterns = [
      /require\s*\(\s*['"]fs['"]\s*\)\.(?!write)/,
      /readFileSync\s*\(/,
    ];
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const line = this._getLineForMatch(content, match.index!);
        issues.push({ type: 'filesystem', severity: 'medium', location: line, description: `Filesystem read: ${match[0]}` });
      }
    }
    return issues;
  }

  private _detectPermissionMismatch(content: string, frontmatter: Record<string, unknown>): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const perms = (frontmatter.permissions ?? {}) as Record<string, boolean>;
    if (perms.network === false && /fetch\s*\(|\bhttp\b|\bhttps\b/.test(content)) {
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
```

- [ ] **Step 2: Write tests for SkillSecurityAuditor**

```typescript
import { describe, it, expect } from 'vitest';
import { SkillSecurityAuditor } from './skill-auditor.js';

describe('SkillSecurityAuditor', () => {
  const auditor = new SkillSecurityAuditor();

  describe('scan() - critical patterns', () => {
    it('detects eval()', () => {
      const report = auditor.scan({ content: 'eval("console.log(1)")', frontmatter: {}, skillId: 'test', skillName: 'test', source: 'unknown' });
      expect(report.issues).toContainEqual(expect.objectContaining({ type: 'eval', severity: 'critical' }));
      expect(report.trustScore).toBeLessThan(100);
    });

    it('detects child_process.spawn', () => {
      const report = auditor.scan({ content: 'require("child_process").spawn("ls")', frontmatter: {}, skillId: 'test', skillName: 'test', source: 'unknown' });
      expect(report.issues).toContainEqual(expect.objectContaining({ type: 'exec', severity: 'critical' }));
    });

    it('detects new Function', () => {
      const report = auditor.scan({ content: 'new Function("console.log(1)")()', frontmatter: {}, skillId: 'test', skillName: 'test', source: 'unknown' });
      expect(report.issues.some(i => i.type === 'eval')).toBe(true);
    });

    it('clean code gets score 100', () => {
      const report = auditor.scan({ content: 'console.log("hello")', frontmatter: {}, skillId: 'test', skillName: 'test', source: 'unknown' });
      expect(report.trustScore).toBe(100);
      expect(report.allowed).toBe(true);
      expect(report.issues).toHaveLength(0);
    });
  });

  describe('scan() - scoring', () => {
    it('score 100 for clean code', () => {
      const report = auditor.scan({ content: 'console.log("test")', frontmatter: {}, skillId: 'test', skillName: 'test', source: 'unknown' });
      expect(report.trustScore).toBe(100);
    });

    it('score capped at 0 (multiple criticals)', () => {
      const content = 'eval("x")' + '\nrequire("child_process").spawn("ls")';
      const report = auditor.scan({ content, frontmatter: {}, skillId: 'test', skillName: 'test', source: 'unknown' });
      expect(report.trustScore).toBe(0);
      expect(report.allowed).toBe(false);
    });

    it('threshold 80 blocks score below 80', () => {
      // One high (-20) leaves score 80, which passes threshold
      const report = auditor.scan({ content: 'require("http")', frontmatter: {}, skillId: 'test', skillName: 'test', source: 'unknown' });
      expect(report.trustScore).toBe(80);
      expect(report.allowed).toBe(true);
    });
  });

  describe('gate()', () => {
    it('sets allowed based on threshold', () => {
      const report = auditor.gate({ skillId: 'test', skillName: 'test', trustScore: 50, allowed: true, issues: [], scannedAt: '', source: 'unknown' });
      expect(report.allowed).toBe(false);
    });
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/doug/ai/system/aether/packages/skill-loader && npx vitest run --reporter=basic src/audit/skill-auditor.test.ts 2>&1
```

- [ ] **Step 4: Commit**

```bash
git add packages/skill-loader/src/audit/skill-auditor.ts packages/skill-loader/src/audit/skill-auditor.test.ts
git commit -m "feat(skill-loader): add SkillSecurityAuditor with static analysis"
```

---

## Task 3: Integrate auditor into SkillRegistry

**Files:**
- Modify: `packages/skill-loader/src/registry/registry.ts`

- [ ] **Step 1: Update SkillRegistry to inject auditor**

Add import and constructor param:

```typescript
import { SkillSecurityAuditor } from '../audit/skill-auditor.js';

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private parser = new SkillParser();
  private auditor: SkillSecurityAuditor;

  constructor(auditor?: SkillSecurityAuditor) {
    this.auditor = auditor ?? new SkillSecurityAuditor();
  }
```

- [ ] **Step 2: Gate register() with audit**

Update `register(skill)` to call audit first:

```typescript
register(skill: Skill) {
  const report = this.auditor.scan({
    content: skill.rawContent,
    frontmatter: skill.level1 as unknown as Record<string, unknown>,
    skillId: skill.id,
    skillName: skill.level1.name,
    source: skill.source,
  });

  if (!report.allowed) {
    console.warn(`[aether:registry] Skill blocked by security audit: ${skill.level1.name} (score=${report.trustScore})`);
    return;
  }

  // Update trust score from audit if higher
  if (report.trustScore > (skill.level1.trustScore ?? 0)) {
    skill.level1.trustScore = report.trustScore;
  }

  this.skills.set(skill.id, skill);
  console.log(`[aether:registry] Registered skill: ${skill.level1.name} (source=${skill.source}, trust=${report.trustScore})`);
}
```

- [ ] **Step 3: Add audit methods**

Add to SkillRegistry class:

```typescript
/**
 * On-demand audit for a registered skill.
 */
auditSkill(skillId: string): AuditReport | null {
  const skill = this.skills.get(skillId);
  if (!skill) return null;
  return this.auditor.scan({
    content: skill.rawContent,
    frontmatter: skill.level1 as unknown as Record<string, unknown>,
    skillId: skill.id,
    skillName: skill.level1.name,
    source: skill.source,
  });
}

/**
 * Audit all registered skills.
 */
auditAll(): AuditReport[] {
  const reports: AuditReport[] = [];
  for (const skill of this.skills.values()) {
    reports.push(this.auditor.scan({
      content: skill.rawContent,
      frontmatter: skill.level1 as unknown as Record<string, unknown>,
      skillId: skill.id,
      skillName: skill.level1.name,
      source: skill.source,
    }));
  }
  return reports;
}
```

Also add `AuditReport` to imports from `'./skill-parser.js'` type import (no, it's from auditor-types). Import `AuditReport` from `'../audit/auditor-types.js'`.

Actually, since SkillRegistry is in `registry/registry.ts` and auditor-types is in `audit/`, the import should be `import type { AuditReport } from '../audit/auditor-types.js';`.

- [ ] **Step 4: Build and verify**

```bash
cd /Users/doug/ai/system/aether/packages/skill-loader && npx tsc --noEmit 2>&1
```

- [ ] **Step 5: Commit**

```bash
git add packages/skill-loader/src/registry/registry.ts
git commit -m "feat(skill-loader): integrate SkillSecurityAuditor into registry"
```

---

## Task 4: Add API endpoint for skill audit

**Files:**
- Create: `packages/gateway/src/routes/skill-audit.ts`
- Modify: `packages/gateway/src/server.ts`

- [ ] **Step 1: Create skill-audit router**

```typescript
import { Router } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SkillParser } from '../../../skill-loader/src/parser/skill-parser.js';
import { SkillSecurityAuditor } from '../../../skill-loader/src/audit/skill-auditor.js';
import type { AuditReport } from '../../../skill-loader/src/audit/auditor-types.js';

export function createSkillAuditRouter(deps: { registry?: any }) {
  const router = Router();
  const auditor = new SkillSecurityAuditor();
  const parser = new SkillParser();

  // POST /api/skill/audit — audit a skill by path or registered id
  router.post('/', async (req, res) => {
    try {
      const { path: skillPath, id: skillId } = req.body as { path?: string; id?: string };
      let report: AuditReport;

      if (skillPath) {
        const content = readFileSync(skillPath, 'utf-8');
        const skill = parser.parseFromContent(content, 'unknown');
        const lockDir = skillPath.includes('/') ? skillPath.substring(0, skillPath.lastIndexOf('/')) : undefined;
        report = auditor.scan({
          content: skill.rawContent,
          frontmatter: skill.level1 as unknown as Record<string, unknown>,
          skillId: skill.id,
          skillName: skill.level1.name,
          source: skill.source,
        });
      } else if (skillId && deps.registry) {
        report = deps.registry.auditSkill(skillId) ?? null;
      } else {
        res.status(400).json({ error: 'Provide path or id' });
        return;
      }

      if (!report) {
        res.status(404).json({ error: 'Skill not found' });
        return;
      }

      res.json(report);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/skill/audit/all — audit all registered skills
  router.get('/all', (req, res) => {
    if (!deps.registry) {
      res.status(500).json({ error: 'Registry not available' });
      return;
    }
    res.json(deps.registry.auditAll());
  });

  return router;
}
```

- [ ] **Step 2: Mount in server.ts**

In `packages/gateway/src/server.ts`, add import and mount:

```typescript
import { createSkillAuditRouter } from './routes/skill-audit.js';

// In createServer() after skill router mount:
const skillAuditRouter = createSkillAuditRouter({ registry });
app.use('/api/skill/audit', skillAuditRouter);
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/doug/ai/system/aether/packages/gateway && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/routes/skill-audit.ts packages/gateway/src/server.ts
git commit -m "feat(gateway): add POST /api/skill/audit and GET /api/skill/audit/all"
```

---

## Task 5: Create CLI command

**Files:**
- Create: `packages/skill-loader/bin/skill-audit.js`

- [ ] **Step 1: Write CLI**

```javascript
#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { SkillParser } from '../src/parser/skill-parser.js';
import { SkillSecurityAuditor } from '../src/audit/skill-auditor.js';

const auditor = new SkillSecurityAuditor();
const parser = new SkillParser();

function auditSkillFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const skill = parser.parseFromContent(content, 'unknown');
    const report = auditor.scan({
      content: skill.rawContent,
      frontmatter: skill.level1,
      skillId: skill.id,
      skillName: skill.level1.name,
      source: skill.source,
    });
    printReport(report);
    return report;
  } catch (err) {
    console.error(`Error auditing ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

function printReport(report) {
  const icon = report.allowed ? '✅' : '🚫';
  console.log(`\n${icon} ${report.skillName} (source=${report.source})`);
  console.log(`   Score: ${report.trustScore}/100 ${report.allowed ? '' : '[BLOCKED]'}`);
  if (report.issues.length > 0) {
    console.log('   Issues:');
    for (const issue of report.issues) {
      console.log(`     [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.description} ${issue.location ? `@ ${issue.location}` : ''}`);
    }
  }
}

// CLI argument parsing
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: skill-audit --path <file-or-dir> [--id <skill-id>]');
  console.error('       skill-audit --path ./skills/my-skill/SKILL.md');
  console.error('       skill-audit --path ./skills/');
  process.exit(1);
}

const pathIdx = args.indexOf('--path');
const idIdx = args.indexOf('--id');

if (pathIdx >= 0) {
  const target = args[pathIdx + 1];
  const stat = statSync(target);
  if (stat.isDirectory()) {
    // Scan all SKILL.md files in directory
    const entries = readdirSync(target);
    for (const entry of entries) {
      const fullPath = join(target, entry);
      if (statSync(fullPath).isDirectory()) {
        const skillFile = join(fullPath, 'SKILL.md');
        try { auditSkillFile(skillFile); } catch { /* skip */ }
      } else if (extname(entry).toLowerCase() === '.md') {
        auditSkillFile(fullPath);
      }
    }
  } else {
    auditSkillFile(target);
  }
} else if (idIdx >= 0) {
  console.log('--id mode requires registry access (not implemented in standalone CLI)');
  process.exit(1);
}
```

- [ ] **Step 2: Make executable and link**

```bash
chmod +x /Users/doug/ai/system/aether/packages/skill-loader/bin/skill-audit.js
```

Add to `packages/skill-loader/package.json`:
```json
"bin": {
  "skill-audit": "./bin/skill-audit.js"
}
```

- [ ] **Step 3: Test CLI**

```bash
cd /Users/doug/ai/system/aether/packages/skill-loader && node bin/skill-audit.js --path ./src/parser/skill-parser.ts 2>&1
```

Should show score 100 (no security issues in parser file).

- [ ] **Step 4: Commit**

```bash
git add packages/skill-loader/bin/skill-audit.js packages/skill-loader/package.json
git commit -m "feat(skill-loader): add skill-audit CLI command"
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|-----------------|------|
| AuditReport/AuditIssue types | Task 1 |
| SkillSecurityAuditor.scan() with regex patterns | Task 2 |
| Scoring algorithm (critical -40, high -20, etc.) | Task 2 |
| gate() method with threshold 80 | Task 2 |
| Registry integration (auto audit on register) | Task 3 |
| auditSkill() and auditAll() methods | Task 3 |
| API endpoint POST /api/skill/audit | Task 4 |
| API endpoint GET /api/skill/audit/all | Task 4 |
| CLI command skill-audit | Task 5 |

No gaps.

---

## Type Consistency Check

- `AuditReport.skillId`, `.skillName`, `.trustScore`, `.allowed`, `.issues`, `.scannedAt`, `.source` — Task 1
- `AuditIssue.type` (IssueType), `.severity` (IssueSeverity), `.location`, `.description` — Task 1
- `SkillSecurityAuditor.scan({ content, frontmatter, skillId, skillName, source })` — Task 2
- `SkillSecurityAuditor.gate(report: AuditReport)` → `AuditReport` — Task 2
- `SkillRegistry.register(skill)` → checks `report.allowed` — Task 3
- `SkillRegistry.auditSkill(skillId)` → `AuditReport | null` — Task 3
- `SkillRegistry.auditAll()` → `AuditReport[]` — Task 3
- CLI: `--path <file-or-dir>` pattern — Task 5

All consistent.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-10-skill-security-audit-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?