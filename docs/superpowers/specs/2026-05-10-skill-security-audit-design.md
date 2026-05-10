# Skill Security Audit Pipeline Design

**Date:** 2026-05-10
**Status:** Approved

## 1. Overview

Unified `SkillSecurityAuditor` class providing static analysis + scoring for skill security. Three integration points: registry auto-audit on scan, CLI on-demand, API on-demand. Score < 80 blocks skill from loading/execution.

## 2. AuditReport Format

```typescript
interface AuditReport {
  skillId: string;
  skillName: string;
  trustScore: number;         // 0-100
  allowed: boolean;           // true if score >= threshold (80)
  issues: AuditIssue[];
  scannedAt: string;
  source: 'manus' | 'openclaw' | 'aether' | 'skillpack' | 'unknown';
}

interface AuditIssue {
  type: 'network' | 'filesystem' | 'exec' | 'eval' | 'secrets' | 'permission_mismatch';
  severity: 'critical' | 'high' | 'medium' | 'low';
  location?: string;          // e.g. "line 42: require('fs')"
  description: string;
}
```

## 3. Scoring Algorithm

Base score: 100. Deductions per issue:
- `critical` → -40 (eval(), child_process spawn, suspicious env access)
- `high` → -20 (network to non-allowlist host, filesystem write outside tmp)
- `medium` → -10 (read-only fs access, declared permission not used)
- `low` → -5 (info-only: permission mismatch warning)

Score = max(0, 100 - totalPenalties)
Threshold: 80 (score < 80 → blocked)

## 4. Static Analysis Patterns

**Critical (eval, subprocess):**
- `eval(`, `new Function(`, `(0,eval)(`, `vm.runIn`
- `child_process.spawn`, `child_process.exec`, `execSync`, `.exec(`
- `process.env` access patterns

**High (network, fs-write):**
- `require('http')`, `require('https')`, `fetch(`, `XMLHttpRequest`
- `require('fs').write`, `writeFileSync`, `createWriteStream`
- `require('fs').writeFile` patterns

**Medium (fs-read, permission mismatch):**
- `require('fs').read`, `readFileSync` without write
- `permissions.network: false` but network patterns detected
- `permissions.filesystem: false` but fs patterns detected

**Low (info):**
- `permissions.exec: true` but no exec patterns in code
- Declared dependencies not found in code

## 5. Three Integration Points

### 5.1 Registry Integration (auto on scan)

`SkillRegistry.register()` calls `auditor.audit(skill)` before registering. If `!report.allowed`, skip registration with warning log.

### 5.2 CLI Command

```bash
skill-audit --path ./skills/my-skill/
skill-audit --path ./skills/               # scan directory
skill-audit --id skill-name                # audit registered skill
```

Output: formatted table of issues + score + allow/block verdict.

### 5.3 API Endpoint

```
POST /api/skill/audit
Body: { "path": "./skills/my-skill/" } | { "id": "skill-name" }
Response: AuditReport JSON
```

Also registers audit results in skill metadata for traceability.

## 6. SkillRegistry Changes

- Add `SecurityAuditor` field to `SkillRegistry`
- `register(skill)` → calls `audit()` first, skips if blocked
- `auditSkill(id): AuditReport | null` — on-demand re-audit
- `auditAll(): AuditReport[]` — scan all registered skills
- API routes: `POST /api/skill/audit`, `GET /api/skill/audit/all`

## 7. Out of Scope

- Remote reputation lookup (local scoring only)
- Automatic remediation suggestions
- Skill signing/verification (EP-03 Phase 2 later)
- Sandbox execution in audit (static analysis only for MVP)