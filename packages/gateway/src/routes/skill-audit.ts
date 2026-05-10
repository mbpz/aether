import { Router } from 'express';
import { readFileSync } from 'fs';
import { SkillParser } from '../../../skill-loader/src/parser/skill-parser.js';
import { SkillSecurityAuditor } from '../../../skill-loader/src/audit/skill-auditor.js';
import type { AuditReport } from '../../../skill-loader/src/audit/auditor-types.js';

export function createSkillAuditRouter(deps: { registry?: any }) {
  const router = Router();
  const auditor = new SkillSecurityAuditor();
  const parser = new SkillParser();

  router.post('/', (req, res) => {
    try {
      const { path: skillPath, id: skillId } = req.body as { path?: string; id?: string };
      let report: AuditReport | null = null;

      if (skillPath) {
        const content = readFileSync(skillPath, 'utf-8');
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
      res.status(500).json({ error: String(err) });
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