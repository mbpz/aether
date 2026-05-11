// Format detection for skill formats: Manus, OpenClaw, and Aether
// Standalone detection logic that can be used without the full parser

import yaml from 'js-yaml';

export type SkillFormat = 'manus' | 'openclaw' | 'aether' | 'unknown';

export interface FormatDetectionResult {
  format: SkillFormat;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

/**
 * Extract YAML frontmatter from markdown content
 */
function extractFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  try {
    return (yaml.load(match[1]) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

/**
 * Get the first N characters of content for early detection
 */
function getHead(content: string, length = 200): string {
  return content.slice(0, length);
}

/**
 * Detect the format of a skill document.
 *
 * Detection strategy (in priority order):
 * 1. Explicit format markers in frontmatter (highest confidence)
 * 2. Format-specific structural markers
 * 3. Section header patterns
 * 4. Content heuristics
 */
export function detectFormat(content: string): FormatDetectionResult {
  const frontmatter = extractFrontmatter(content);
  const head = getHead(content);
  const reasons: string[] = [];

  // === Aether detection (highest priority for Aether-native) ===
  if (frontmatter['aether-skill'] === true || frontmatter['aether-skill'] === 'true') {
    reasons.push('frontmatter:aether-skill');
    return { format: 'aether', confidence: 'high', reasons };
  }
  if (frontmatter.aether === true || frontmatter.aether === 'true') {
    reasons.push('frontmatter:aether marker');
    return { format: 'aether', confidence: 'high', reasons };
  }

  // === OpenClaw detection ===
  if (frontmatter['openclaw-plugin'] === true) {
    reasons.push('frontmatter:openclaw-plugin');
    return { format: 'openclaw', confidence: 'high', reasons };
  }
  if (Array.isArray(frontmatter.actions) && frontmatter.actions.length > 0) {
    reasons.push('frontmatter:actions array (OpenClaw-native)');
    return { format: 'openclaw', confidence: 'high', reasons };
  }

  // === Manus detection ===
  // Manus has explicit id field in frontmatter
  if (typeof frontmatter.id === 'string' && frontmatter.id.length > 0) {
    reasons.push('frontmatter:id field (Manus-native)');
    // Manus also typically has permissions array
    if (Array.isArray(frontmatter.permissions)) {
      reasons.push('frontmatter:permissions array');
      return { format: 'manus', confidence: 'high', reasons };
    }
    return { format: 'manus', confidence: 'high', reasons };
  }

  // Manus skills array in frontmatter
  if (Array.isArray(frontmatter['skills']) && frontmatter['skills'].length > 0) {
    reasons.push('frontmatter:skills array (Manus-native)');
    return { format: 'manus', confidence: 'high', reasons };
  }

  // Manus-specific section headers
  if (content.includes('## System Prompt')) {
    reasons.push('section:## System Prompt');
    return { format: 'manus', confidence: 'high', reasons };
  }
  if (content.includes('# Level 1:')) {
    reasons.push('section:# Level 1: structure');
    return { format: 'manus', confidence: 'high', reasons };
  }
  if (head.includes('manus-skill')) {
    reasons.push('marker:manus-skill in first 200 chars');
    return { format: 'manus', confidence: 'high', reasons };
  }

  // === OpenClaw structural markers ===
  if (content.includes('## Tools') && !content.includes('## System Prompt')) {
    reasons.push('section:## Tools (without ## System Prompt)');
    return { format: 'openclaw', confidence: 'medium', reasons };
  }
  if (content.includes('## Actions')) {
    reasons.push('section:## Actions');
    return { format: 'openclaw', confidence: 'high', reasons };
  }

  // === Aether structural markers ===
  // Aether uses three-tier: metadata / instructions / resources
  const hasInstructions = content.includes('## Instructions');
  const hasResources = content.includes('## Resources');
  const hasMetadata = content.includes('## Metadata');
  if (hasMetadata && hasInstructions && hasResources) {
    reasons.push('section:three-tier structure (Metadata/Instructions/Resources)');
    return { format: 'aether', confidence: 'high', reasons };
  }
  // Aether often uses Level 1/2/3 but without Manus markers
  if (content.includes('# Level 1:') && content.includes('# Level 2:') && content.includes('# Level 3:')) {
    // Check it's not Manus (which has ## System Prompt)
    if (!content.includes('## System Prompt')) {
      reasons.push('section:Level 1/2/3 structure (Aether style)');
      return { format: 'aether', confidence: 'medium', reasons };
    }
  }

  // === Manus vs OpenClaw via section analysis ===
  if (hasInstructions && !content.includes('## Tools')) {
    reasons.push('section:## Instructions without ## Tools');
    return { format: 'manus', confidence: 'medium', reasons };
  }
  if (content.includes('## Tools') && !hasInstructions) {
    reasons.push('section:## Tools without ## Instructions');
    return { format: 'openclaw', confidence: 'medium', reasons };
  }

  // === Fallback: check for valid frontmatter ===
  const hasName = typeof frontmatter.name === 'string';
  const hasVersion = 'version' in frontmatter;
  const hasDescription = 'description' in frontmatter;

  if (hasName || hasVersion || hasDescription) {
    // We have a valid skill frontmatter but can't determine exact format
    if (hasInstructions) {
      reasons.push('fallback:has frontmatter + Instructions section');
      return { format: 'manus', confidence: 'low', reasons };
    }
    if (content.includes('## Tools')) {
      reasons.push('fallback:has frontmatter + Tools section');
      return { format: 'openclaw', confidence: 'low', reasons };
    }
    // Default to aether for generic skills with frontmatter
    reasons.push('fallback:generic skill frontmatter');
    return { format: 'aether', confidence: 'low', reasons };
  }

  // === Unknown ===
  reasons.push('no recognizable markers');
  return { format: 'unknown', confidence: 'low', reasons };
}

/**
 * Simple format detection returning just the format
 */
export function detectFormatSimple(content: string): SkillFormat {
  return detectFormat(content).format;
}
