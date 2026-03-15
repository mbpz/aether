// SKILL.md 解析器 - 兼容 Manus SKILL.md 格式
// 实现三级披露机制：Level 1 元数据 → Level 2 指令 → Level 3 资源

import { readFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';

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
  source: 'manus' | 'openclaw' | 'aether' | 'unknown';
}

export class SkillParser {

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
  parseFromContent(content: string, source = 'unknown'): Skill {
    const frontmatter = this.extractFrontmatter(content);
    const sections = this.extractSections(content);

    // 检测来源格式
    const skillSource = this.detectSource(content, frontmatter);

    // Level 1: 元数据
    const level1: SkillMetadata = {
      name: frontmatter.name ?? this.extractTitle(content) ?? 'Unknown Skill',
      version: frontmatter.version ?? '1.0.0',
      description: frontmatter.description ?? sections['description'] ?? '',
      category: frontmatter.category ?? 'general',
      author: frontmatter.author,
      trustScore: frontmatter.trust_score ?? 0,
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
    if (codeSection || frontmatter.dependencies) {
      level3 = {
        code: codeSection,
        dependencies: frontmatter.dependencies ?? [],
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
    const sectionRegex = /^##\s+(.+)\n([\s\S]*?)(?=^##\s|\n$|$)/gm;
    let match;
    while ((match = sectionRegex.exec(content)) !== null) {
      const sectionName = match[1].trim().toLowerCase();
      sections[sectionName] = match[2].trim();
    }
    return sections;
  }

  private detectSource(content: string, frontmatter: Record<string, any>): Skill['source'] {
    if (frontmatter.platform === 'manus' || content.includes('manus-skill')) return 'manus';
    if (frontmatter.platform === 'openclaw' || content.includes('openclaw')) return 'openclaw';
    if (frontmatter.platform === 'aether') return 'aether';
    // Manus 格式特征检测
    if (content.includes('## System Prompt') || content.includes('## Instructions')) return 'manus';
    return 'unknown';
  }
}
