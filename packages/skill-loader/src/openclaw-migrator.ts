// OpenClaw Migration Tool - Phase 3: OpenClaw 迁移工具
// Converts OpenClaw plugin format to Aether native format

import yaml from 'js-yaml';
import type { ConversionResult } from './format-converter.js';

// =============================================================================
// OpenClaw Plugin Types
// =============================================================================

/**
 * OpenClaw action definition
 */
export interface OpenClawAction {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  returns?: unknown;
  permissions?: string[];
}

/**
 * OpenClaw hook definition
 */
export interface OpenClawHook {
  name: string;
  description: string;
  handler?: string;
}

/**
 * OpenClaw permission definition
 */
export interface OpenClawPermission {
  name: string;
  description?: string;
  required: boolean;
}

/**
 * Parsed OpenClaw plugin structure
 */
export interface OpenClawPlugin {
  name: string;
  version: string;
  description?: string;
  author?: string;
  category?: string;
  tags?: string[];
  actions: OpenClawAction[];
  permissions: OpenClawPermission[];
  hooks: OpenClawHook[];
  metadata: Record<string, unknown>;
}

/**
 * Unsupported hook names that cannot be directly mapped to Aether
 */
const UNSUPPORTED_HOOKS = new Set([
  'onNetworkRequest',
  'onFileSystemChange',
  'onProcessSpawn',
  'onSecurityEvent',
  'onCustomEvent',
]);

/**
 * Hooks that have partial support or need warning
 */
const PARTIALLY_SUPPORTED_HOOKS = new Set([
  'onStartup',
  'onShutdown',
  'onError',
  'beforeAction',
  'afterAction',
]);

// =============================================================================
// Parsing
// =============================================================================

/**
 * Extract YAML frontmatter from markdown content
 * Handles both standard format (with closing ---) and OpenClaw format (without closing ---)
 */
function extractFrontmatter(content: string): Record<string, unknown> {
  // First try standard format with closing ---
  let match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (match) {
    try {
      return (yaml.load(match[1]) as Record<string, unknown>) ?? {};
    } catch {
      return {};
    }
  }
  // Try OpenClaw format without closing --- (just --- at start followed by YAML)
  match = content.match(/^---\n([\s\S]*)$/);
  if (match) {
    try {
      return (yaml.load(match[1]) as Record<string, unknown>) ?? {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Extract markdown sections from content body
 * Handles sections with blank lines between header and content
 */
function extractSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = content.split('\n');
  let currentSection: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const sectionMatch = line.match(/^##\s+(.+)/);
    if (sectionMatch) {
      // Save previous section
      if (currentSection !== null) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = sectionMatch[1].trim().toLowerCase();
      currentContent = [];
    } else if (currentSection !== null) {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentSection !== null) {
    sections[currentSection] = currentContent.join('\n').trim();
  }

  return sections;
}

/**
 * Parse OpenClaw plugin content into structured form
 */
function parseOpenClawPlugin(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
  sections: Record<string, string>;
} {
  const frontmatter = extractFrontmatter(content);
  // Handle both standard format (with closing ---) and OpenClaw format (without closing ---)
  let body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  if (body === content) {
    // No change means closing --- wasn't found, try without it
    body = content.replace(/^---\n[\s\S]*$/, '');
  }
  const sections = extractSections(body);
  return { frontmatter, body, sections };
}

/**
 * Convert raw frontmatter actions to OpenClawAction array
 */
function parseActions(frontmatter: Record<string, unknown>): OpenClawAction[] {
  const actions = frontmatter.actions;
  if (!Array.isArray(actions)) {
    return [];
  }
  return actions
    .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
    .map((a) => ({
      name: typeof a.name === 'string' ? a.name : 'unnamed',
      description: typeof a.description === 'string' ? a.description : '',
      parameters: a.parameters as Record<string, unknown> | undefined,
      returns: a.returns,
      permissions: Array.isArray(a.permissions) ? a.permissions.map(String) : undefined,
    }));
}

/**
 * Convert raw frontmatter permissions to OpenClawPermission array
 */
function parsePermissions(frontmatter: Record<string, unknown>): OpenClawPermission[] {
  const permissions = frontmatter.permissions;
  if (!permissions) {
    return [];
  }
  if (Array.isArray(permissions)) {
    return permissions
      .filter((p): p is string | Record<string, unknown> => p !== null)
      .map((p) => {
        if (typeof p === 'string') {
          return { name: p, required: true };
        }
        return {
          name: typeof p.name === 'string' ? p.name : 'unknown',
          description: typeof p.description === 'string' ? p.description : undefined,
          required: p.required !== false,
        };
      });
  }
  return [];
}

/**
 * Convert raw frontmatter hooks to OpenClawHook array
 */
function parseHooks(frontmatter: Record<string, unknown>): OpenClawHook[] {
  const hooks = frontmatter.hooks;
  if (!hooks) {
    return [];
  }
  if (Array.isArray(hooks)) {
    return hooks
      .filter((h): h is Record<string, unknown> => h !== null && typeof h === 'object')
      .map((h) => ({
        name: typeof h.name === 'string' ? h.name : 'unknown',
        description: typeof h.description === 'string' ? h.description : '',
        handler: typeof h.handler === 'string' ? h.handler : undefined,
      }));
  }
  return [];
}

// =============================================================================
// Conversion
// =============================================================================

/**
 * Convert OpenClaw actions to Level 2/3 instructions format
 */
function convertActionsToInstructions(actions: OpenClawAction[]): string[] {
  const lines: string[] = [];

  if (actions.length === 0) {
    return lines;
  }

  lines.push('## Actions');
  lines.push('');

  for (const action of actions) {
    lines.push(`### ${action.name}`);
    lines.push('');
    lines.push(action.description);
    lines.push('');

    if (action.parameters && Object.keys(action.parameters).length > 0) {
      lines.push('**Parameters:**');
      lines.push('```json');
      lines.push(JSON.stringify(action.parameters, null, 2));
      lines.push('```');
      lines.push('');
    }

    if (action.returns !== undefined) {
      lines.push('**Returns:**');
      lines.push('```json');
      lines.push(JSON.stringify(action.returns, null, 2));
      lines.push('```');
      lines.push('');
    }
  }

  return lines;
}

/**
 * Convert OpenClaw permissions to Level 1 permissions format
 */
function convertPermissionsToLevel1(permissions: OpenClawPermission[]): string[] {
  const lines: string[] = [];

  if (permissions.length === 0) {
    return lines;
  }

  lines.push('## Permissions');
  lines.push('');
  lines.push('| Permission | Required | Description |');
  lines.push('|------------|----------|-------------|');

  for (const perm of permissions) {
    const desc = perm.description || 'No description';
    const required = perm.required ? 'Yes' : 'No';
    lines.push(`| ${perm.name} | ${required} | ${desc} |`);
  }

  lines.push('');
  return lines;
}

/**
 * Generate warnings for unsupported or partially supported hooks
 */
function generateHookWarnings(hooks: OpenClawHook[]): string[] {
  const warnings: string[] = [];

  for (const hook of hooks) {
    if (UNSUPPORTED_HOOKS.has(hook.name)) {
      warnings.push(
        `Hook '${hook.name}' is not supported in Aether and will be ignored during migration`
      );
    } else if (PARTIALLY_SUPPORTED_HOOKS.has(hook.name)) {
      warnings.push(
        `Hook '${hook.name}' has limited support in Aether; manual review recommended`
      );
    }
  }

  if (hooks.length > 0 && warnings.length === 0) {
    warnings.push('All hooks have been migrated with best-effort mapping');
  }

  return warnings;
}

// =============================================================================
// Main Migration Function
// =============================================================================

/**
 * Migrate an OpenClaw plugin to Aether native format
 *
 * OpenClaw format characteristics:
 * - Frontmatter with openclaw-plugin: true or actions array
 * - Actions array defining available operations
 * - Permissions array for access control
 * - Hooks array for lifecycle events
 *
 * Aether mapping:
 * - name → Level 1 metadata
 * - version → Level 1 metadata
 * - description → Level 1 description
 * - permissions → Level 1 permissions section
 * - actions → Level 2 instructions
 * - hooks → warnings (unsupported)
 *
 * @param pluginContent - Raw OpenClaw plugin content (markdown with frontmatter)
 * @returns ConversionResult with migrated content and any warnings/errors
 */
export function migrateOpenClawPlugin(pluginContent: string): ConversionResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    // Parse the plugin content
    const { frontmatter, sections } = parseOpenClawPlugin(pluginContent);

    // Validate this looks like OpenClaw format
    const isOpenClaw =
      frontmatter['openclaw-plugin'] === true || Array.isArray(frontmatter.actions);
    if (!isOpenClaw) {
      errors.push('Content does not appear to be OpenClaw format (missing openclaw-plugin marker or actions array)');
      return { success: false, warnings, errors };
    }

    // Parse structured plugin data
    const plugin: OpenClawPlugin = {
      name: typeof frontmatter.name === 'string' ? frontmatter.name : 'Unnamed OpenClaw Skill',
      version: typeof frontmatter.version === 'string' ? frontmatter.version : '1.0.0',
      description: typeof frontmatter.description === 'string' ? frontmatter.description : undefined,
      author: typeof frontmatter.author === 'string' ? frontmatter.author : undefined,
      category: typeof frontmatter.category === 'string' ? frontmatter.category : 'general',
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.filter((t): t is string => typeof t === 'string') : [],
      actions: parseActions(frontmatter),
      permissions: parsePermissions(frontmatter),
      hooks: parseHooks(frontmatter),
      metadata: frontmatter,
    };

    // Build Aether frontmatter
    const aetherFrontmatter: Record<string, unknown> = {
      'aether-skill': true,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description || '',
      category: plugin.category,
      tags: plugin.tags,
      platform: ['aether', 'openclaw'],
      converted_from: 'openclaw',
      converted_to: 'aether',
      converted_at: new Date().toISOString(),
    };

    if (plugin.author) {
      aetherFrontmatter.author = plugin.author;
    }

    const lines: string[] = ['---', yaml.dump(aetherFrontmatter), '---', ''];

    // Level 1: Metadata
    lines.push('# Level 1: Metadata');
    lines.push('');
    lines.push(`> ${plugin.description || 'No description provided'}`);
    lines.push('');

    // Level 1: Permissions (if present)
    const permLines = convertPermissionsToLevel1(plugin.permissions);
    if (permLines.length > 0) {
      lines.push(...permLines);
    }

    // Level 2: Instructions
    lines.push('# Level 2: Instructions');
    lines.push('');

    // Convert actions to instruction format
    const actionLines = convertActionsToInstructions(plugin.actions);
    if (actionLines.length > 0) {
      lines.push(...actionLines);
    } else {
      // If no actions, check for existing content in body
      const bodyContent = sections['actions'] || sections['instructions'] || '';
      if (bodyContent) {
        lines.push(bodyContent);
        lines.push('');
      }
    }

    // Tools section from original (if present)
    if (sections['tools']) {
      lines.push('## Tools');
      lines.push('');
      lines.push(sections['tools']);
      lines.push('');
    }

    // Level 3: Resources (if code or implementation present)
    const codeSection = sections['code'] || sections['implementation'] || '';
    if (codeSection) {
      lines.push('# Level 3: Resources');
      lines.push('');
      lines.push('## Code');
      lines.push('```');
      lines.push(codeSection);
      lines.push('```');
      lines.push('');
    }

    // Generate warnings for hooks
    const hookWarnings = generateHookWarnings(plugin.hooks);
    warnings.push(...hookWarnings);

    // General migration warnings
    if (plugin.hooks.length > 0) {
      warnings.push(`${plugin.hooks.length} hook(s) detected - OpenClaw hooks are not natively supported in Aether`);
    }
    warnings.push('Review migrated skill for any platform-specific functionality that may need adjustment');

    return {
      success: true,
      output: lines.join('\n'),
      warnings,
      errors: [],
    };
  } catch (e) {
    errors.push(`Migration failed: ${e instanceof Error ? e.message : String(e)}`);
    return { success: false, warnings, errors };
  }
}

/**
 * Parse OpenClaw plugin without migrating - returns structured plugin object
 */
export function parseOpenClawPluginOnly(content: string): {
  plugin: OpenClawPlugin | null;
  errors: string[];
} {
  const errors: string[] = [];

  try {
    const { frontmatter } = parseOpenClawPlugin(content);

    const isOpenClaw =
      frontmatter['openclaw-plugin'] === true || Array.isArray(frontmatter.actions);
    if (!isOpenClaw) {
      errors.push('Content does not appear to be OpenClaw format');
      return { plugin: null, errors };
    }

    const plugin: OpenClawPlugin = {
      name: typeof frontmatter.name === 'string' ? frontmatter.name : 'Unnamed OpenClaw Skill',
      version: typeof frontmatter.version === 'string' ? frontmatter.version : '1.0.0',
      description: typeof frontmatter.description === 'string' ? frontmatter.description : undefined,
      author: typeof frontmatter.author === 'string' ? frontmatter.author : undefined,
      category: typeof frontmatter.category === 'string' ? frontmatter.category : 'general',
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.filter((t): t is string => typeof t === 'string') : [],
      actions: parseActions(frontmatter),
      permissions: parsePermissions(frontmatter),
      hooks: parseHooks(frontmatter),
      metadata: frontmatter,
    };

    return { plugin, errors: [] };
  } catch (e) {
    errors.push(`Parse failed: ${e instanceof Error ? e.message : String(e)}`);
    return { plugin: null, errors };
  }
}
