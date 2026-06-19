import { Router } from 'express';
import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import { isAbsolute, resolve, sep } from 'path';
import { SkillParser } from '@aether/skill-loader/parser';
import { SkillSecurityAuditor, type AuditReport } from '@aether/skill-loader/audit';

// Allowlisted file names the audit endpoint is permitted to read.
const ALLOWED_SKILL_FILES = new Set(['SKILL.md', 'skill.md', '.skillpack-lock.json']);

// Resolve the audit root from env, defaulting to a project-local directory.
// All `path` inputs must resolve to a file inside this root, otherwise the
// request is rejected. This prevents arbitrary file reads on the host.
const RAW_AUDIT_ROOT = resolve(process.env.SKILL_AUDIT_ROOT ?? './skills');
// Always compare against the canonical (realpath) form of the root, so
// intermediate symlinks such as macOS's `/tmp -> /private/tmp` cannot trick
// the containment check. Fall back to the raw value if the root does not
// exist yet (e.g. on a fresh checkout) so the audit endpoint can still boot.
const AUDIT_ROOT = (() => {
  try { return realpathSync(RAW_AUDIT_ROOT); } catch { return RAW_AUDIT_ROOT; }
})();
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB hard cap on a single skill file

function sanitizeSkillPath(input: unknown): { ok: true; absPath: string } | { ok: false; reason: string } {
  if (typeof input !== 'string' || input.length === 0) {
    return { ok: false, reason: 'path must be a non-empty string' };
  }
  if (input.includes('\0')) {
    return { ok: false, reason: 'path contains NUL byte' };
  }

  // Reject traversal segments and absolute paths up front so we never even
  // stat them. This blocks `..`, leading `/`, and Windows drive letters.
  if (input.includes('..')) {
    return { ok: false, reason: 'path traversal is not allowed' };
  }
  if (isAbsolute(input)) {
    return { ok: false, reason: 'absolute paths are not allowed' };
  }

  const candidate = resolve(AUDIT_ROOT, input);

  // Ensure the resolved path stays within AUDIT_ROOT (no symlink escape).
  // Compare with a trailing separator so `/skills-evil` cannot match `/skills`.
  const rootWithSep = AUDIT_ROOT.endsWith(sep) ? AUDIT_ROOT : AUDIT_ROOT + sep;
  if (candidate !== AUDIT_ROOT && !candidate.startsWith(rootWithSep)) {
    return { ok: false, reason: 'path escapes the audit root' };
  }

  // Realpath catches symlinks pointing outside the root.
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    return { ok: false, reason: 'path does not exist' };
  }
  if (!real.startsWith(rootWithSep) && real !== AUDIT_ROOT) {
    return { ok: false, reason: 'symlink target escapes the audit root' };
  }

  // Only known skill filenames may be read.
  const base = candidate.split(sep).pop() ?? '';
  if (!ALLOWED_SKILL_FILES.has(base)) {
    return { ok: false, reason: `file '${base}' is not in the allowlist` };
  }

  const st = statSync(real);
  if (!st.isFile()) {
    return { ok: false, reason: 'path is not a regular file' };
  }
  if (st.size > MAX_FILE_BYTES) {
    return { ok: false, reason: `file exceeds ${MAX_FILE_BYTES} bytes` };
  }

  return { ok: true, absPath: real };
}

export function createSkillAuditRouter(deps: { registry?: any }) {
  const router = Router();
  const auditor = new SkillSecurityAuditor();
  const parser = new SkillParser();

  router.post('/', (req, res) => {
    try {
      const { path: skillPath, id: skillId } = req.body as { path?: unknown; id?: string };
      let report: AuditReport | null = null;

      if (skillPath) {
        const safe = sanitizeSkillPath(skillPath);
        if (!safe.ok) {
          res.status(400).json({ error: 'Invalid path', reason: safe.reason });
          return;
        }
        const content = readFileSync(safe.absPath, 'utf-8');
        const skill = parser.parseFromContent(content, 'unknown');
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
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/all', (req, res) => {
    if (!deps.registry) {
      res.status(500).json({ error: 'Registry not available' });
      return;
    }
    res.json(deps.registry.auditAll());
  });

  return router;
}
