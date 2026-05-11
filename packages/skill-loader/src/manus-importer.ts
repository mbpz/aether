// Manus Playbook Importer - Phase 3: Manus Playbook 导入
// Parses Manus Playbook format and converts to Aether native format

import yaml from 'js-yaml';

export interface PlaybookStep {
  id?: string;
  name: string;
  description?: string;
  action?: string;
  conditions?: string[];
  timeout?: number;
}

export interface PlaybookVariable {
  name: string;
  description?: string;
  default?: string;
  required?: boolean;
}

export interface ManusPlaybook {
  playbook?: boolean;
  name: string;
  version?: string;
  description?: string;
  trigger?: string | string[];
  triggers?: string[];
  variables?: PlaybookVariable[];
  env_vars?: Record<string, string>;
  steps: PlaybookStep[];
  metadata?: Record<string, unknown>;
}

export interface ConversionResult {
  success: boolean;
  output?: string;
  warnings: string[];
  errors: string[];
}

// =============================================================================
// Frontmatter extraction
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

// =============================================================================
// Manus Playbook parsing
// =============================================================================

/**
 * Parse Manus Playbook content into structured format
 */
export function parseManusPlaybook(content: string): ManusPlaybook | null {
  const { frontmatter, body } = extractFrontmatter(content);

  // Check if this is a Manus Playbook
  const isPlaybook = frontmatter.playbook === true ||
    frontmatter.playbook === 'true' ||
    Array.isArray(frontmatter.steps);

  if (!isPlaybook && !body.includes('steps:')) {
    return null;
  }

  const steps = parseSteps(body);

  const triggers: string[] = [];
  if (frontmatter.trigger) {
    if (typeof frontmatter.trigger === 'string') {
      triggers.push(frontmatter.trigger);
    } else if (Array.isArray(frontmatter.trigger)) {
      triggers.push(...(frontmatter.trigger as string[]));
    }
  }
  if (frontmatter.triggers) {
    if (typeof frontmatter.triggers === 'string') {
      triggers.push(frontmatter.triggers);
    } else if (Array.isArray(frontmatter.triggers)) {
      triggers.push(...(frontmatter.triggers as string[]));
    }
  }

  const variables: PlaybookVariable[] = [];
  if (Array.isArray(frontmatter.variables)) {
    for (const v of frontmatter.variables) {
      if (typeof v === 'object' && v !== null) {
        variables.push(v as PlaybookVariable);
      } else if (typeof v === 'string') {
        variables.push({ name: v });
      }
    }
  }

  return {
    playbook: true,
    name: (frontmatter.name as string) || 'Unnamed Playbook',
    version: frontmatter.version as string | undefined,
    description: frontmatter.description as string | undefined,
    trigger: triggers.length > 0 ? triggers[0] : undefined,
    triggers,
    variables,
    env_vars: frontmatter.env_vars as Record<string, string> | undefined,
    steps,
    metadata: frontmatter.metadata as Record<string, unknown> | undefined,
  };
}

/**
 * Parse steps from playbook body content
 */
function parseSteps(body: string): PlaybookStep[] {
  const steps: PlaybookStep[] = [];

  // Try to parse steps as YAML array from frontmatter
  const frontmatterMatch = body.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (frontmatterMatch) {
    try {
      const fm = yaml.load(frontmatterMatch[1]) as Record<string, unknown>;
      if (Array.isArray(fm.steps)) {
        return fm.steps.map((s, i) => parseStepFromYaml(s, i));
      }
    } catch {
      // Fall through to other parsing
    }
  }

  // Look for steps at root level in body (no frontmatter or after frontmatter)
  const bodyAfterFrontmatter = frontmatterMatch ? frontmatterMatch[2] : body;

  // Try to find steps section - use yaml to properly parse nested structure
  // Match from "steps:" to end of content (no more frontmatter delimiters or headers)
  const stepsMatch = bodyAfterFrontmatter.match(/(?:^|\n)steps:\s*\n([\s\S]*)$/);
  if (stepsMatch) {
    const stepsContent = stepsMatch[1];

    // Parse as YAML to properly handle nested structure
    try {
      const parsed = yaml.load(`steps:\n${stepsContent}`) as { steps?: unknown[] };
      if (parsed?.steps && Array.isArray(parsed.steps)) {
        return parsed.steps.map((s, i) => parseStepFromYaml(s, i));
      }
    } catch {
      // Fall through to line parsing
    }

    // Fallback: line-by-line parsing that handles - name: X correctly
    const lines = stepsContent.split('\n');
    let currentStep: PlaybookStep | null = null;
    let currentConditions: string[] = [];
    let inStep = false;

    for (const line of lines) {
      // Skip empty lines
      if (!line.trim()) continue;

      // Array item that starts a new step
      const arrayItemMatch = line.match(/^(\s*)\-\s*(name|description|action|conditions|timeout|id):\s*(.*)$/);
      if (arrayItemMatch && !inStep) {
        // This is a step that starts with a key-value pair on the same line
        // e.g., "  - name: First Step"
        if (currentStep && currentStep.name) {
          if (currentConditions.length > 0) {
            currentStep.conditions = currentConditions;
          }
          steps.push(currentStep);
        }
        currentStep = { name: arrayItemMatch[3].trim() };
        currentConditions = [];
        inStep = true;
        continue;
      }

      // This is a new step starting with just "- "
      const newStepMatch = line.match(/^(\s*)\-\s*(\S.*)$/);
      if (newStepMatch && !arrayItemMatch) {
        if (currentStep && currentStep.name) {
          if (currentConditions.length > 0) {
            currentStep.conditions = currentConditions;
          }
          steps.push(currentStep);
        }
        currentStep = { name: newStepMatch[2].trim() };
        currentConditions = [];
        inStep = true;
        continue;
      }

      // We're in a step, parse key: value
      if (currentStep !== null) {
        const keyMatch = line.match(/^\s+(\w+):\s*(.*)$/);
        if (keyMatch) {
          const [, key, value] = keyMatch;
          const trimmedValue = value.trim();

          if (key === 'name') {
            currentStep.name = trimmedValue;
          } else if (key === 'description') {
            currentStep.description = trimmedValue;
          } else if (key === 'action') {
            currentStep.action = trimmedValue;
          } else if (key === 'timeout') {
            currentStep.timeout = parseInt(trimmedValue, 10);
          } else if (key === 'id') {
            currentStep.id = trimmedValue;
          }
        } else if (line.match(/^\s+-\s+(.+)/)) {
          // Conditions array item
          const condMatch = line.match(/^\s+-\s+(.+)/);
          if (condMatch) {
            currentConditions.push(condMatch[1].trim());
          }
        }
      }
    }

    if (currentStep && currentStep.name) {
      if (currentConditions.length > 0) {
        currentStep.conditions = currentConditions;
      }
      steps.push(currentStep);
    }
  }

  return steps;
}

function parseStepFromYaml(stepData: unknown, index: number): PlaybookStep {
  const step: PlaybookStep = { name: `Step ${index + 1}` };

  if (typeof stepData === 'object' && stepData !== null) {
    const s = stepData as Record<string, unknown>;
    if (typeof s.name === 'string') step.name = s.name;
    if (typeof s.description === 'string') step.description = s.description;
    if (typeof s.action === 'string') step.action = s.action;
    if (typeof s.id === 'string') step.id = s.id;
    if (typeof s.timeout === 'number') step.timeout = s.timeout;
    if (Array.isArray(s.conditions)) {
      step.conditions = s.conditions.filter(c => typeof c === 'string') as string[];
    }
  }

  return step;
}

// =============================================================================
// Conversion to Aether format
// =============================================================================

/**
 * Convert Manus Playbook to Aether native format
 *
 * Mapping:
 * - name → Level 1 (metadata name)
 * - steps → Level 2 (instructions)
 * - triggers → Level 1 metadata
 * - variables → env_vars (Level 1 metadata)
 */
export function importManusPlaybook(playbookContent: string): ConversionResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    const playbook = parseManusPlaybook(playbookContent);

    if (!playbook) {
      errors.push('Content does not appear to be a Manus Playbook format');
      return { success: false, warnings, errors };
    }

    if (!playbook.name || playbook.name === 'Unnamed Playbook') {
      errors.push('Playbook must have a name');
      return { success: false, warnings, errors };
    }

    if (!playbook.steps || playbook.steps.length === 0) {
      warnings.push('Playbook has no steps - creating empty instruction set');
    } else if (playbook.steps.length > 10) {
      warnings.push('Playbook has many steps - consider breaking into smaller skills');
    }

    // Build Aether frontmatter
    const frontmatter: Record<string, unknown> = {
      'aether-skill': true,
      name: playbook.name,
      version: playbook.version || '1.0.0',
      description: playbook.description || '',
      category: 'playbook',
      playbook: true,
      platform: ['aether', 'manus'],
    };

    // Map triggers to frontmatter
    if (playbook.triggers && playbook.triggers.length > 0) {
      frontmatter.triggers = playbook.triggers;
    }

    // Map variables to env_vars
    if (playbook.variables && playbook.variables.length > 0) {
      frontmatter.env_vars = playbook.variables.reduce((acc, v) => {
        acc[v.name] = v.default || '';
        return acc;
      }, {} as Record<string, string>);
    }

    // Build output content
    const lines: string[] = ['---', yaml.dump(frontmatter), '---', ''];

    // Level 1: Metadata
    lines.push('# Level 1: Metadata');
    lines.push('');
    lines.push(`> ${playbook.description || 'Playbook: ' + playbook.name}`);
    lines.push('');
    lines.push(`**Name:** ${playbook.name}`);
    lines.push(`**Version:** ${playbook.version || '1.0.0'}`);
    lines.push('');

    // Triggers section
    if (playbook.triggers && playbook.triggers.length > 0) {
      lines.push('## Triggers');
      lines.push('');
      for (const trigger of playbook.triggers) {
        lines.push(`- ${trigger}`);
      }
      lines.push('');
    }

    // Variables section
    if (playbook.variables && playbook.variables.length > 0) {
      lines.push('## Variables');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(playbook.variables, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Level 2: Instructions (Steps)
    lines.push('# Level 2: Instructions');
    lines.push('');
    lines.push('## Steps');
    lines.push('');

    if (playbook.steps && playbook.steps.length > 0) {
      for (let i = 0; i < playbook.steps.length; i++) {
        const step = playbook.steps[i];
        const stepNum = i + 1;

        lines.push(`### Step ${stepNum}: ${step.name}`);
        lines.push('');

        if (step.description) {
          lines.push(step.description);
          lines.push('');
        }

        if (step.action) {
          lines.push('**Action:**');
          lines.push('```');
          lines.push(step.action);
          lines.push('```');
          lines.push('');
        }

        if (step.conditions && step.conditions.length > 0) {
          lines.push('**Conditions:**');
          for (const condition of step.conditions) {
            lines.push(`- ${condition}`);
          }
          lines.push('');
        }

        if (step.timeout) {
          lines.push(`**Timeout:** ${step.timeout}s`);
          lines.push('');
        }
      }
    } else {
      lines.push('_No steps defined_');
      lines.push('');
    }

    // Level 3: Resources (if applicable)
    if (playbook.env_vars && Object.keys(playbook.env_vars).length > 0) {
      lines.push('# Level 3: Resources');
      lines.push('');
      lines.push('## Environment Variables');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(playbook.env_vars, null, 2));
      lines.push('```');
      lines.push('');
    }

    // Warnings for potential issues
    if (playbook.steps && playbook.steps.length > 10) {
      warnings.push('Playbook has many steps - consider breaking into smaller skills');
    }

    warnings.push('Review converted playbook steps for action accuracy');

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
// Validation utilities
// =============================================================================

/**
 * Validate a Manus Playbook structure
 */
export function validatePlaybook(playbook: ManusPlaybook): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!playbook.name) {
    errors.push('Playbook name is required');
  }

  if (!playbook.steps || playbook.steps.length === 0) {
    errors.push('Playbook must have at least one step');
  } else {
    for (let i = 0; i < playbook.steps.length; i++) {
      const step = playbook.steps[i];
      if (!step.name) {
        errors.push(`Step ${i + 1} is missing a name`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if content appears to be a Manus Playbook
 */
export function isManusPlaybook(content: string): boolean {
  const { frontmatter, body } = extractFrontmatter(content);

  // Check frontmatter markers
  if (frontmatter.playbook === true || frontmatter.playbook === 'true') {
    return true;
  }

  // Check for steps array
  if (Array.isArray(frontmatter.steps) && frontmatter.steps.length > 0) {
    return true;
  }

  // Check body for steps pattern
  if (body.includes('steps:') || body.match(/^- step \d+:/m)) {
    return true;
  }

  return false;
}