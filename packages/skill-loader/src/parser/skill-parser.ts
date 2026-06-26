// SKILL.md 解析器 - 兼容 Manus SKILL.md 格式
// 实现三级披露机制：Level 1 元数据 → Level 2 指令 → Level 3 资源

import { readFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';

import { SkillpackLockLoader } from './skilllock-loader.js';
import { SkillpackEntry } from './skilllock-types.js';

// Level 1: 元数据（永远加载，< 100 tokens）
export interface SkillMetadata {
  name: string;
  version: string;
  description: string;
  category: string;
  author?: string;
  trustScore?: number;   // 0-100，安全审计分数
  tags?: string[];
  platform?: string[];   // ['manus', 'openclaw', 'aether']
}

// Level 2: 指令层（按需加载，~500 tokens）
export interface SkillInstructions {
  systemPrompt: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  examples?: Array<{ input: unknown; output: unknown }>;
  triggers?: string[];   // 触发关键词
}

// Level 3: 资源层（执行时加载）
export interface SkillResources {
  code?: string;
  dependencies?: string[];
  secretsRequired?: string[];  // 需要的 Vault 密钥名
  permissions?: {
    network?: boolean;
    filesystem?: boolean;
    exec?: boolean;
  };
}

export interface Skill {
  id: string;
  level1: SkillMetadata;
  level2?: SkillInstructions;
  level3?: SkillResources;
  rawContent: string;
  source: 'manus' | 'openclaw' | 'aether' | 'skillpack' | 'unknown';
}

export class SkillParser {
  private lockLoader = new SkillpackLockLoader();

  /**
   * 从 SKILL.md 文件解析技能（兼容 Manus 格式）
   */
  parseFromFile(filePath: string): Skill {
    if (!existsSync(filePath)) {
      throw new Error(`Skill file not found: ${filePath}`);
    }
    const content = readFileSync(filePath, 'utf-8');
    return this.parseFromContent(content, filePath);
  }

  /**
   * 从 Markdown 内容解析技能
   */
  parseFromContent(content: string, source = 'unknown', lockDir?: string): Skill {
    const frontmatter = this.extractFrontmatter(content);
    const sections = this.extractSections(content);

    // 检测来源格式
    let skillSource = this.detectSource(content, frontmatter);

    // Load skillpack lock file if directory provided
    let lockEntries: SkillpackEntry[] = [];
    if (lockDir) {
      const lock = this.lockLoader.loadLockFile(lockDir);
      if (lock) {
        const deps = frontmatter.dependencies as string[] | undefined;
        if (Array.isArray(deps)) {
          for (const dep of deps) {
            if (dep.startsWith('skillpack/')) {
              const entry = this.lockLoader.resolveDep(dep, lock);
              if (entry) lockEntries.push(entry);
              else console.warn(`[aether:skillpack] Unresolved dep: ${dep} in ${lockDir}`);
            }
          }
          if (lockEntries.length > 0) skillSource = 'skillpack';
        }
      } else {
        console.warn(`[aether:skillpack] Lock file not found in ${lockDir}`);
      }
    }

    // Level 1: 元数据
    const level1: SkillMetadata = {
      name: frontmatter.name ?? this.extractTitle(content) ?? 'Unknown Skill',
      version: frontmatter.version ?? '1.0.0',
      description: frontmatter.description ?? sections['description'] ?? '',
      category: frontmatter.category ?? 'general',
      author: frontmatter.author,
      trustScore: frontmatter.trust_score ??
        (lockEntries.length > 0 ? lockEntries[0].trustScore : 0),
      tags: frontmatter.tags ?? [],
      platform: frontmatter.platform ?? [skillSource],
    };

    // Level 2: 指令层
    let level2: SkillInstructions | undefined;
    const systemPromptSection = sections['system prompt'] ?? sections['instructions'] ?? sections['prompt'];
    if (systemPromptSection) {
      level2 = {
        systemPrompt: systemPromptSection.trim(),
        inputSchema: frontmatter.input_schema,
        outputSchema: frontmatter.output_schema,
        triggers: frontmatter.triggers ?? [],
      };
    }

    // Level 3: 资源层
    let level3: SkillResources | undefined;
    const codeSection = sections['code'] ?? sections['implementation'];
    const depsSection = sections['dependencies'];
    const parsedDeps = depsSection
      ? depsSection.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim())
      : [];
    const dependencies = frontmatter.dependencies ?? parsedDeps;
    if (codeSection || dependencies.length > 0) {
      level3 = {
        code: codeSection,
        dependencies,
        secretsRequired: frontmatter.secrets_required ?? [],
        permissions: frontmatter.permissions,
      };
    }

    return {
      id: `skill-${level1.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
      level1,
      level2,
      level3,
      rawContent: content,
      source: skillSource,
    };
  }

  private extractFrontmatter(content: string): Record<string, any> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    try {
      return (yaml.load(match[1]) as Record<string, any>) ?? {};
    } catch {
      return {};
    }
  }

  private extractTitle(content: string): string | undefined {
    const match = content.match(/^#\s+(.+)$/m);
    return match?.[1]?.trim();
  }

  private extractSections(content: string): Record<string, string> {
    const sections: Record<string, string> = {};
    // Section boundary: next `## ` heading OR document end. Use non-m flag
    // so `\n$` only matches the actual end-of-string, not every blank line.
    // Fix from B2 retro-fit: previously the regex was /m + (?=\n$|$) which
    // matched any blank line inside the section, truncating content.
    const sectionRegex = /(^|\n)##\s+(.+)\n([\s\S]*?)(?=\n##\s|$)/g;
    let match;
    while ((match = sectionRegex.exec(content)) !== null) {
      const sectionName = match[2].trim().toLowerCase();
      sections[sectionName] = match[3].trim();
    }
    return sections;
  }

  /**
   * Robust format detection for SKILL.md variants.
   * Uses frontmatter first (most reliable), then section headers, then content heuristics.
   */
  private detectSource(content: string, frontmatter: Record<string, any>): Skill['source'] {
    // 1. Explicit platform in frontmatter (highest priority)
    if (frontmatter.platform === 'manus') return 'manus';
    if (frontmatter.platform === 'openclaw') return 'openclaw';
    if (frontmatter.platform === 'aether') return 'aether';

    // 2. OpenClaw-specific markers in frontmatter
    if (frontmatter['openclaw-plugin'] === true) return 'openclaw';

    // 3. Aether-specific markers in frontmatter
    if (frontmatter.aether === true) return 'aether';

    // 4. Manus-specific markers in frontmatter (skills array is Manus-native)
    const skills = frontmatter['skills'];
    if (Array.isArray(skills) && skills.length > 0) return 'manus';

    // 5. Check first 200 chars for early markers (avoid false positives from body text)
    const head = content.slice(0, 200);

    if (head.includes('manus-skill')) return 'manus';

    // 6. Manus-specific section headers
    if (content.includes('## System Prompt')) return 'manus';
    if (content.includes('# Level 1:')) return 'manus';

    // 7. OpenClaw-specific section (check early to avoid generic "Tools" matches)
    if (head.includes('## Tools')) return 'openclaw';

    // 8. Manus-compatible: ## Instructions (distinguish from other platforms)
    if (content.includes('## Instructions')) {
      // If we see ## Tools elsewhere in content, it's OpenClaw
      if (content.includes('## Tools')) return 'openclaw';
      return 'manus';
    }

    // 9. OpenClaw: ## Tools section (when not already matched)
    if (content.includes('## Tools')) return 'openclaw';

    // 10. Generic SKILL.md validation: if frontmatter has required fields, treat as valid
    // This allows SkillRegistry to handle it as a generic skill
    if (this.hasValidFrontmatter(frontmatter)) {
      // Distinguish by section patterns if possible
      if (content.includes('## Instructions')) return 'manus';
      if (content.includes('## Tools')) return 'openclaw';
      return 'unknown'; // Let SkillRegistry handle as generic
    }

    return 'unknown';
  }

  /**
   * Check if frontmatter has the hallmarks of a valid SKILL.md.
   * If name, description, or version fields are present, it's likely a skill.
   */
  private hasValidFrontmatter(frontmatter: Record<string, any>): boolean {
    const required = ['name', 'description', 'version'];
    return required.some(field => field in frontmatter);
  }
}
