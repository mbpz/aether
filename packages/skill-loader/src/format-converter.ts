// Skill Format Auto-Converter
// Converts between Manus SKILL.md, OpenClaw plugin, and Aether native formats
// Preserves all original metadata during conversion

import yaml from 'js-yaml';
import { SkillParser, Skill } from './parser/skill-parser.js';
import { detectFormat, detectFormatSimple, SkillFormat } from './format-detector.js';

export interface ConversionResult {
  success: boolean;
  output?: string;
  warnings: string[];
  errors: string[];
}

export interface ConversionOptions {
  /** Add conversion metadata to output frontmatter */
  includeConversionMeta?: boolean;
  /** Preserve original formatting where possible */
  preserveFormatting?: boolean;
}

// =============================================================================
// Frontmatter extraction helpers
// =============================================================================

function extractFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  try {
    return {
      frontmatter: (yaml.load(match[1]) as Record<string, unknown>) ?? {},
      body: match[2],
    };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

function extractSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  // 抓 `## Heading` 直到下一个 `## ` / `# ` 标题，或文档结束（$ 在非 m 模式下 = 末尾）。
  // 之前用 `\n$` + m 模式当终止符，多行模式下任何空行都会命中，
  // 导致 ` ``` ` 代码块开头那个空行就提前截断 section。
  const sectionRegex = /(?:^|\n)##\s+(.+)\n([\s\S]*?)(?=\n#{1,2}\s|$)/g;
  let match;
  while ((match = sectionRegex.exec(content)) !== null) {
    const sectionName = match[1].trim().toLowerCase();
    sections[sectionName] = match[2].trim();
  }
  return sections;
}

function extractLevelSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  // # Level N: Name 直到下一个 # / ## 标题，或文档末尾。
  const levelRegex = /(?:^|\n)#+\s*Level\s*(\d+):\s*([^\n]+)\n([\s\S]*?)(?=\n#+\s*Level\s*\d+:|\n##\s|$)/g;
  let match;
  while ((match = levelRegex.exec(content)) !== null) {
    const level = match[1];
    const name = match[2].trim().toLowerCase();
    sections[`level${level}_${name}`] = match[3].trim();
  }
  // 也抓标准 ## section（同样规则）。
  const standardRegex = /(?:^|\n)##\s+(.+)\n([\s\S]*?)(?=\n#{1,2}\s|$)/g;
  while ((match = standardRegex.exec(content)) !== null) {
    const sectionName = match[1].trim().toLowerCase();
    if (!sections[sectionName]) {
      sections[sectionName] = match[2].trim();
    }
  }
  return sections;
}

// =============================================================================
// Conversion metadata helpers
// =============================================================================

function addConversionMeta(
  frontmatter: Record<string, unknown>,
  sourceFormat: SkillFormat,
  targetFormat: SkillFormat
): Record<string, unknown> {
  return {
    ...frontmatter,
    converted_from: sourceFormat,
    converted_to: targetFormat,
    converted_at: new Date().toISOString(),
  };
}

// =============================================================================
// Manus to Aether conversion
// =============================================================================

/**
 * Convert Manus SKILL.md format to Aether native format
 *
 * Manus format characteristics:
 * - Has frontmatter with id, name, version, permissions
 * - Level 1/2/3 structure with # Level N: headers
 * - ## System Prompt section
 *
 * Conversion notes:
 * - Manus permissions map to Aether permissions
 * - Manus "skills" array becomes tags
 * - Manus triggers become Aether triggers
 */
export function convertManusToAether(content: string, options: ConversionOptions = {}): ConversionResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    const { frontmatter, body } = extractFrontmatter(content);
    const sections = extractLevelSections(body);

    // Validate this looks like Manus format
    if (!frontmatter.id && !frontmatter.name) {
      errors.push('Manus format requires id or name in frontmatter');
      return { success: false, warnings, errors };
    }

    // Build Aether frontmatter
    const aetherFrontmatter: Record<string, unknown> = {
      'aether-skill': true,
      name: frontmatter.name || frontmatter.id,
      version: frontmatter.version || '1.0.0',
      description: frontmatter.description || '',
      category: frontmatter.category || 'general',
      author: frontmatter.author,
      tags: frontmatter.tags || frontmatter.skills || [],
      platform: ['aether', 'manus'], // Mark as compatible with both
    };

    // Add conversion metadata
    if (options.includeConversionMeta !== false) {
      Object.assign(aetherFrontmatter, addConversionMeta(frontmatter, 'manus', 'aether'));
    }

    // Build output content
    const lines: string[] = ['---', yaml.dump(aetherFrontmatter), '---', ''];

    // Level 1: Metadata
    lines.push('# Level 1: Metadata');
    lines.push('');
    lines.push(`> ${frontmatter.description || 'No description provided'}`);
    lines.push('');

    // Level 2: Instructions
    lines.push('# Level 2: Instructions');
    lines.push('');
    const systemPrompt = sections['system prompt'] || sections['level2_system prompt'] || sections['instructions'] || '';
    if (systemPrompt) {
      lines.push('## System Prompt');
      lines.push('');
      lines.push(systemPrompt);
      lines.push('');
    }

    // Input/Output schemas if present
    if (frontmatter.input_schema) {
      lines.push('## Input Schema');
      lines.push('```json');
      lines.push(JSON.stringify(frontmatter.input_schema, null, 2));
      lines.push('```');
      lines.push('');
    }
    if (frontmatter.output_schema) {
      lines.push('## Output Schema');
      lines.push('```json');
      lines.push(JSON.stringify(frontmatter.output_schema, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Triggers
    const triggers = frontmatter.triggers as string[] | undefined;
    if (triggers && triggers.length > 0) {
      lines.push('## Triggers');
      lines.push('');
      lines.push(triggers.map(t => `- ${t}`).join('\n'));
      lines.push('');
    }

    // Level 3: Resources
    const code = sections['code'] || sections['level3_code'] || sections['implementation'] || '';
    const dependencies = frontmatter.dependencies as string[] | undefined;

    if (code || dependencies || frontmatter.secrets_required) {
      lines.push('# Level 3: Resources');
      lines.push('');

      if (code) {
        lines.push('## Code');
        lines.push('```');
        lines.push(code);
        lines.push('```');
        lines.push('');
      }

      if (dependencies && dependencies.length > 0) {
        lines.push('## Dependencies');
        lines.push('');
        lines.push(dependencies.map(d => `- ${d}`).join('\n'));
        lines.push('');
      }

      if (frontmatter.secrets_required) {
        lines.push('## Secrets Required');
        lines.push('');
        lines.push((frontmatter.secrets_required as string[]).map(s => `- ${s}`).join('\n'));
        lines.push('');
      }
    }

    // Warnings for non-1:1 translations
    if (frontmatter.permissions) {
      warnings.push('Manus permissions preserved in frontmatter but may need manual review for Aether policy');
    }
    if (frontmatter.trust_score !== undefined) {
      warnings.push('Manus trust_score not directly mapped; use Aether security auditor for trust scoring');
    }

    return {
      success: true,
      output: lines.join('\n'),
      warnings,
      errors: [],
    };
  } catch (e) {
    errors.push(`Conversion failed: ${e instanceof Error ? e.message : String(e)}`);
    return { success: false, warnings, errors };
  }
}

// =============================================================================
// OpenClaw to Aether conversion
// =============================================================================

/**
 * Convert OpenClaw plugin format to Aether native format
 *
 * OpenClaw format characteristics:
 * - Has frontmatter with openclaw-plugin: true
 * - Has actions array instead of Level 2/3
 * - ## Tools section for tool definitions
 *
 * Conversion notes:
 * - OpenClaw actions become Aether instructions
 * - OpenClaw tools become Aether resources/code
 */
export function convertOpenClawToAether(content: string, options: ConversionOptions = {}): ConversionResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    const { frontmatter, body } = extractFrontmatter(content);
    const sections = extractLevelSections(body);

    // Validate this looks like OpenClaw format
    const isOpenClaw = frontmatter['openclaw-plugin'] === true ||
                       Array.isArray(frontmatter.actions);
    if (!isOpenClaw) {
      errors.push('Content does not appear to be OpenClaw format');
      return { success: false, warnings, errors };
    }

    // Build Aether frontmatter
    const aetherFrontmatter: Record<string, unknown> = {
      'aether-skill': true,
      name: frontmatter.name || 'Unnamed OpenClaw Skill',
      version: frontmatter.version || '1.0.0',
      description: frontmatter.description || '',
      category: frontmatter.category || 'general',
      author: frontmatter.author,
      tags: frontmatter.tags || [],
      platform: ['aether', 'openclaw'],
    };

    // Add conversion metadata
    if (options.includeConversionMeta !== false) {
      Object.assign(aetherFrontmatter, addConversionMeta(frontmatter, 'openclaw', 'aether'));
    }

    const lines: string[] = ['---', yaml.dump(aetherFrontmatter), '---', ''];

    // Level 1: Metadata
    lines.push('# Level 1: Metadata');
    lines.push('');
    lines.push(`> ${frontmatter.description || 'No description provided'}`);
    lines.push('');

    // Level 2: Instructions
    lines.push('# Level 2: Instructions');
    lines.push('');

    // OpenClaw actions become the main instructions
    const actions = frontmatter.actions as Array<Record<string, unknown>> | undefined;
    if (actions && actions.length > 0) {
      lines.push('## Actions');
      lines.push('');
      for (const action of actions) {
        const name = action.name as string || 'unnamed';
        const description = action.description as string || '';
        lines.push(`### ${name}`);
        lines.push('');
        lines.push(description);
        lines.push('');
        if (action.parameters) {
          lines.push('**Parameters:**');
          lines.push('```json');
          lines.push(JSON.stringify(action.parameters, null, 2));
          lines.push('```');
          lines.push('');
        }
      }
    }

    // Tools section
    if (sections['tools']) {
      lines.push('## Tools');
      lines.push('');
      lines.push(sections['tools']);
      lines.push('');
    } else if (body.includes('## Tools')) {
      // Extract tools section manually
      const toolsMatch = body.match(/## Tools\n([\s\S]*?)(?=^##|\n$|$)/m);
      if (toolsMatch) {
        lines.push('## Tools');
        lines.push('');
        lines.push(toolsMatch[1].trim());
        lines.push('');
      }
    }

    // Level 3: Resources
    const code = sections['code'] || sections['implementation'] || '';

    if (code || actions) {
      lines.push('# Level 3: Resources');
      lines.push('');

      if (code) {
        lines.push('## Code');
        lines.push('```');
        lines.push(code);
        lines.push('```');
        lines.push('');
      }
    }

    // Warnings
    if (actions) {
      warnings.push('OpenClaw actions converted to instruction format; verify behavior matches original');
    }
    if (frontmatter['openclaw-plugin']) {
      warnings.push('OpenClaw plugin-specific configuration may need manual adjustment');
    }

    return {
      success: true,
      output: lines.join('\n'),
      warnings,
      errors: [],
    };
  } catch (e) {
    errors.push(`Conversion failed: ${e instanceof Error ? e.message : String(e)}`);
    return { success: false, warnings, errors };
  }
}

// =============================================================================
// Aether to Manus conversion
// =============================================================================

/**
 * Convert Aether native format to Manus SKILL.md format
 *
 * Conversion notes:
 * - Aether three-tier becomes Manus Level 1/2/3
 * - Aether metadata becomes Manus frontmatter
 */
export function convertAetherToManus(content: string, options: ConversionOptions = {}): ConversionResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    const { frontmatter, body } = extractFrontmatter(content);
    const sections = extractLevelSections(body);

    // Validate this looks like Aether format
    const isAether = frontmatter['aether-skill'] === true ||
                     (frontmatter.name && sections['instructions']);
    if (!isAether) {
      errors.push('Content does not appear to be Aether format');
      return { success: false, warnings, errors };
    }

    // Build Manus frontmatter
    const manusFrontmatter: Record<string, unknown> = {
      id: frontmatter.id || `manus-${(frontmatter.name as string || 'skill').toLowerCase().replace(/\s+/g, '-')}`,
      name: frontmatter.name,
      version: frontmatter.version || '1.0.0',
      description: frontmatter.description || '',
      permissions: frontmatter.permissions || [],
      platform: 'manus',
    };

    // Add conversion metadata
    if (options.includeConversionMeta !== false) {
      Object.assign(manusFrontmatter, addConversionMeta(frontmatter, 'aether', 'manus'));
    }

    const lines: string[] = ['---', yaml.dump(manusFrontmatter), '---', ''];

    // Extract content sections
    const level1Content = sections['level1_metadata'] || sections['metadata'] || '';
    const level2Content = sections['level2_instructions'] || sections['instructions'] || '';
    const level3Content = sections['level3_resources'] || sections['resources'] || '';

    // Level 1: Metadata
    lines.push('# Level 1: Metadata');
    lines.push('');
    if (level1Content) {
      lines.push(level1Content);
    } else {
      lines.push(`**Name:** ${frontmatter.name}`);
      lines.push(`**Version:** ${frontmatter.version}`);
      lines.push(`**Category:** ${frontmatter.category || 'general'}`);
    }
    lines.push('');

    // Level 2: Instructions
    lines.push('# Level 2: Instructions');
    lines.push('');
    if (level2Content) {
      lines.push(level2Content);
    } else {
      lines.push('## System Prompt');
      lines.push('');
      lines.push((frontmatter.description as string) || 'No instructions provided');
    }
    lines.push('');

    // Level 3: Resources
    if (level3Content || frontmatter.dependencies || frontmatter.code) {
      lines.push('# Level 3: Resources');
      lines.push('');
      if (level3Content) {
        lines.push(level3Content);
      }
      if (frontmatter.dependencies) {
        lines.push('## Dependencies');
        lines.push('');
        lines.push((frontmatter.dependencies as string[]).join('\n'));
        lines.push('');
      }
    }

    // Warnings
    warnings.push('Aether-specific features (e.g., secretsRequired) not directly convertible to Manus format');
    warnings.push('Review converted skill for any platform-specific functionality');

    return {
      success: true,
      output: lines.join('\n'),
      warnings,
      errors: [],
    };
  } catch (e) {
    errors.push(`Conversion failed: ${e instanceof Error ? e.message : String(e)}`);
    return { success: false, warnings, errors };
  }
}

// =============================================================================
// Auto-detect and convert
// =============================================================================

/**
 * Auto-detect format and convert to Aether
 * Convenience function for migration workflows
 */
export function autoConvertToAether(content: string, options: ConversionOptions = {}): ConversionResult {
  const format = detectFormatSimple(content);

  switch (format) {
    case 'manus':
      return convertManusToAether(content, options);
    case 'openclaw':
      return convertOpenClawToAether(content, options);
    case 'aether':
      // No conversion needed, but still validate and return with warning
      return {
        success: true,
        output: content,
        warnings: ['Content is already in Aether format, no conversion performed'],
        errors: [],
      };
    default:
      return {
        success: false,
        output: undefined,
        warnings: [],
        errors: [`Unable to auto-detect format. Detected: ${format}`],
      };
  }
}

/**
 * Auto-detect format and convert to target format
 */
export function autoConvert(content: string, targetFormat: SkillFormat, options: ConversionOptions = {}): ConversionResult {
  const sourceFormat = detectFormatSimple(content);

  if (sourceFormat === targetFormat) {
    return {
      success: true,
      output: content,
      warnings: [`Content is already in ${targetFormat} format`],
      errors: [],
    };
  }

  if (sourceFormat === 'unknown') {
    return {
      success: false,
      errors: ['Unable to detect source format'],
      warnings: [],
    };
  }

  // Convert to Aether first, then to target if needed
  if (targetFormat === 'aether') {
    if (sourceFormat === 'manus') return convertManusToAether(content, options);
    if (sourceFormat === 'openclaw') return convertOpenClawToAether(content, options);
  }

  if (targetFormat === 'manus') {
    if (sourceFormat === 'aether') return convertAetherToManus(content, options);
    // For openclaw -> manus, convert via aether
    if (sourceFormat === 'openclaw') {
      const toAether = convertOpenClawToAether(content, options);
      if (!toAether.success) return toAether;
      return convertAetherToManus(toAether.output!, options);
    }
  }

  if (targetFormat === 'openclaw') {
    // Manus and Aether both convert to OpenClaw via their respective converters
    // For now, OpenClaw output is similar to Aether
    if (sourceFormat === 'aether') {
      // Aether to OpenClaw: treat as similar format with warnings
      const { frontmatter, body } = extractFrontmatter(content);
      const ocFrontmatter: Record<string, unknown> = {
        'openclaw-plugin': true,
        name: frontmatter.name,
        version: frontmatter.version || '1.0.0',
        description: frontmatter.description,
        actions: [],
      };
      if (options.includeConversionMeta !== false) {
        Object.assign(ocFrontmatter, addConversionMeta(frontmatter, 'aether', 'openclaw'));
      }
      return {
        success: true,
        output: `---\n${yaml.dump(ocFrontmatter)}\n---\n\n${body}`,
        warnings: ['OpenClaw output is similar to Aether; manual review recommended'],
        errors: [],
      };
    }
    if (sourceFormat === 'manus') {
      const toAether = convertManusToAether(content, options);
      if (!toAether.success) return toAether;
      const { frontmatter, body } = extractFrontmatter(toAether.output!);
      const ocFrontmatter: Record<string, unknown> = {
        'openclaw-plugin': true,
        name: frontmatter.name,
        version: frontmatter.version || '1.0.0',
        description: frontmatter.description,
        actions: [],
      };
      Object.assign(ocFrontmatter, addConversionMeta(frontmatter, 'manus', 'openclaw'));
      return {
        success: true,
        output: `---\n${yaml.dump(ocFrontmatter)}\n---\n\n${body}`,
        warnings: ['OpenClaw output converted via Aether; manual review recommended'],
        errors: [],
      };
    }
  }

  return {
    success: false,
    errors: [`Conversion from ${sourceFormat} to ${targetFormat} not supported`],
    warnings: [],
  };
}

// =============================================================================
// Parse and validate
// =============================================================================

/**
 * Parse content using SkillParser and return structured Skill
 * This validates the content and provides full structured output
 */
export function parseSkill(content: string, source = 'unknown'): Skill {
  const parser = new SkillParser();
  return parser.parseFromContent(content, source);
}

/**
 * Detect format and validate that content can be parsed
 */
export function detectAndValidate(content: string): { format: SkillFormat; valid: boolean; errors: string[] } {
  const format = detectFormatSimple(content);
  const errors: string[] = [];

  try {
    const { frontmatter } = extractFrontmatter(content);
    if (format !== 'unknown') {
      // Basic validation based on format
      if (format === 'manus') {
        // Manus 规范要求 name + version + id（至少 name+version 二者俱在；缺 id 也算 issue）。
        // 之前只查 (!id && !name)，所以 "name 有但缺 version/id" 完全不被检出。
        if (!frontmatter.name) errors.push('Manus format requires name in frontmatter');
        if (!frontmatter.id) errors.push('Manus format should have id in frontmatter');
        if (!frontmatter.version) errors.push('Manus format requires version in frontmatter');
      }
      if (format === 'openclaw' && frontmatter['openclaw-plugin'] !== true && !Array.isArray(frontmatter.actions)) {
        errors.push('OpenClaw format should have openclaw-plugin: true or actions array');
      }
      if (format === 'aether') {
        if (!frontmatter.name) errors.push('Aether format requires name in frontmatter');
        if (!frontmatter.version) errors.push('Aether format requires version in frontmatter');
      }
    }
  } catch (e) {
    errors.push(`Validation error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    format,
    valid: errors.length === 0,
    errors,
  };
}
