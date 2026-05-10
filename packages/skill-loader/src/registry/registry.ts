// Skill Registry - 技能注册表
// 管理技能生命周期，实现三级渐进式加载

import { readdir, stat } from 'fs/promises';
import { readFileSync } from 'fs';
import { join, extname, dirname } from 'path';
import { SkillParser, Skill, SkillMetadata } from '../parser/skill-parser.js';
import { SkillSecurityAuditor } from '../audit/skill-auditor.js';
import type { AuditReport } from '../audit/auditor-types.js';

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private parser = new SkillParser();
  private auditor: SkillSecurityAuditor;

  constructor(auditor?: SkillSecurityAuditor) {
    this.auditor = auditor ?? new SkillSecurityAuditor();
  }

  /**
   * 从目录批量扫描并注册技能
   */
  async scanDirectory(dir: string): Promise<number> {
    let count = 0;
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const s = await stat(fullPath);
        if (s.isDirectory()) {
          // 递归扫描子目录
          const subDir = join(fullPath, 'SKILL.md');
          count += await this.tryLoadSkill(subDir);
        } else if (extname(entry).toLowerCase() === '.md') {
          count += await this.tryLoadSkill(fullPath);
        }
      }
    } catch (err) {
      console.warn(`[aether:registry] Cannot scan directory ${dir}:`, err);
    }
    return count;
  }

  private async tryLoadSkill(filePath: string): Promise<number> {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lockDir = dirname(filePath);
      const skill = this.parser.parseFromContent(content, 'unknown', lockDir);
      this.register(skill);
      return 1;
    } catch {
      return 0;
    }
  }

  /**
   * 注册一个技能
   */
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

    if (report.trustScore > (skill.level1.trustScore ?? 0)) {
      skill.level1.trustScore = report.trustScore;
    }

    this.skills.set(skill.id, skill);
    console.log(`[aether:registry] Registered skill: ${skill.level1.name} (source=${skill.source}, trust=${report.trustScore})`);
  }

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

  /**
   * Level 1 加载：仅返回元数据（< 100 tokens）
   */
  listLevel1(): SkillMetadata[] {
    return Array.from(this.skills.values()).map((s) => s.level1);
  }

  /**
   * Level 2 加载：返回元数据 + 指令层
   */
  getLevel2(skillId: string): Pick<Skill, 'level1' | 'level2'> | null {
    const skill = this.skills.get(skillId);
    if (!skill) return null;
    return { level1: skill.level1, level2: skill.level2 };
  }

  /**
   * Level 3 加载：返回完整技能（执行时使用）
   */
  getLevel3(skillId: string): Skill | null {
    return this.skills.get(skillId) ?? null;
  }

  /**
   * 按名称搜索技能
   */
  search(query: string): SkillMetadata[] {
    const q = query.toLowerCase();
    return Array.from(this.skills.values())
      .filter((s) =>
        s.level1.name.toLowerCase().includes(q) ||
        s.level1.description.toLowerCase().includes(q) ||
        s.level1.tags?.some((t) => t.toLowerCase().includes(q))
      )
      .map((s) => s.level1);
  }

  stats() {
    const bySource = {} as Record<string, number>;
    for (const skill of this.skills.values()) {
      bySource[skill.source] = (bySource[skill.source] ?? 0) + 1;
    }
    return {
      total: this.skills.size,
      bySource,
    };
  }
}
