import { describe, it, expect } from 'vitest';
import {
  migrateOpenClawPlugin,
  parseOpenClawPluginOnly,
  type OpenClawPlugin,
} from './openclaw-migrator.js';

// =============================================================================
// Basic Migration Tests
// =============================================================================

describe('migrateOpenClawPlugin', () => {
  it('migrates basic OpenClaw plugin with actions', () => {
    const content = `---
openclaw-plugin: true
name: File Operator
version: 1.0.0
description: File operations tool
author: Test Author
category: utility
actions:
  - name: readFile
    description: Read file contents
    parameters:
      path: string
  - name: writeFile
    description: Write content to file
    parameters:
      path: string
      content: string
---
## Tools

- readFile(path): Reads file contents
- writeFile(path, content): Writes content to file`;

    const result = migrateOpenClawPlugin(content);

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output).toContain('aether-skill: true');
    expect(result.output).toContain('name: File Operator');
    expect(result.output).toContain('version: 1.0.0');
    expect(result.output).toContain('converted_from: openclaw');
    expect(result.output).toContain('# Level 1: Metadata');
    expect(result.output).toContain('# Level 2: Instructions');
    expect(result.output).toContain('### readFile');
    expect(result.output).toContain('### writeFile');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('migrates OpenClaw plugin with permissions', () => {
    const content = `---
openclaw-plugin: true
name: Network Tool
version: 1.0.0
description: Network operations
permissions:
  - name: network
    description: Required for network access
    required: true
  - name: filesystem
    description: Required for config files
    required: false
actions:
  - name: fetchUrl
    description: Fetch URL content
---
## Actions
Network tool actions`;

    const result = migrateOpenClawPlugin(content);

    expect(result.success).toBe(true);
    expect(result.output).toContain('# Level 1: Metadata');
    expect(result.output).toContain('## Permissions');
    expect(result.output).toContain('| network | Yes |');
    expect(result.output).toContain('| filesystem | No |');
  });

  it('migrates OpenClaw plugin with hooks and generates warnings', () => {
    const content = `---
openclaw-plugin: true
name: Hooked Plugin
version: 1.0.0
description: Plugin with hooks
actions:
  - name: doSomething
    description: Does something
hooks:
  - name: onStartup
    description: Called on startup
  - name: onNetworkRequest
    description: Network event hook
`;

    const result = migrateOpenClawPlugin(content);

    expect(result.success).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Hook 'onNetworkRequest' is not supported")
    );
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Hook 'onStartup' has limited support")
    );
  });

  it('returns error for non-OpenClaw content', () => {
    const content = `---
name: Not OpenClaw
---
## System Prompt
Not an OpenClaw plugin`;

    const result = migrateOpenClawPlugin(content);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('does not appear to be OpenClaw format');
  });

  it('handles OpenClaw plugin detected via actions array', () => {
    const content = `---
name: Actions Based Plugin
version: 1.0.0
actions:
  - name: action1
    description: First action
`;

    const result = migrateOpenClawPlugin(content);

    expect(result.success).toBe(true);
    expect(result.output).toContain('name: Actions Based Plugin');
    expect(result.output).toContain('### action1');
  });

  it('handles missing optional fields gracefully', () => {
    const content = `---
openclaw-plugin: true
name: Minimal Plugin
---
## Tools
Minimal tool`;

    const result = migrateOpenClawPlugin(content);

    expect(result.success).toBe(true);
    expect(result.output).toContain('name: Minimal Plugin');
    expect(result.output).toContain('version: 1.0.0'); // default version
  });

  it('handles plugin with tags', () => {
    const content = `---
openclaw-plugin: true
name: Tagged Plugin
version: 1.0.0
tags:
  - utility
  - fileops
actions:
  - name: op
    description: An operation
`;

    const result = migrateOpenClawPlugin(content);

    expect(result.success).toBe(true);
    expect(result.output).toContain('tags:');
    expect(result.output).toContain('- utility');
    expect(result.output).toContain('- fileops');
  });

  it('handles plugin with code/implementation section', () => {
    const content = `---
openclaw-plugin: true
name: Code Plugin
version: 1.0.0
actions:
  - name: execute
    description: Execute code
---
## Code

\`\`\`javascript
function execute() {
  return 'executed';
}
\`\`\``;

    const result = migrateOpenClawPlugin(content);

    expect(result.success).toBe(true);
    expect(result.output).toContain('# Level 3: Resources');
    expect(result.output).toContain('## Code');
  });
});

// =============================================================================
// parseOpenClawPluginOnly Tests
// =============================================================================

describe('parseOpenClawPluginOnly', () => {
  it('parses valid OpenClaw plugin', () => {
    const content = `---
openclaw-plugin: true
name: Parse Test
version: 2.0.0
description: Test parsing
author: Parser
category: test
tags:
  - parsing
  - test
actions:
  - name: testAction
    description: Test action
permissions:
  - name: test
    required: true
hooks:
  - name: onStartup
    description: Startup hook
`;

    const { plugin, errors } = parseOpenClawPluginOnly(content);

    expect(errors).toHaveLength(0);
    expect(plugin).not.toBeNull();
    expect(plugin!.name).toBe('Parse Test');
    expect(plugin!.version).toBe('2.0.0');
    expect(plugin!.author).toBe('Parser');
    expect(plugin!.category).toBe('test');
    expect(plugin!.tags).toEqual(['parsing', 'test']);
    expect(plugin!.actions).toHaveLength(1);
    expect(plugin!.actions[0].name).toBe('testAction');
    expect(plugin!.permissions).toHaveLength(1);
    expect(plugin!.permissions[0].name).toBe('test');
    expect(plugin!.hooks).toHaveLength(1);
    expect(plugin!.hooks[0].name).toBe('onStartup');
  });

  it('returns error for invalid content', () => {
    const content = `---
name: Not OpenClaw
---
Invalid content`;

    const { plugin, errors } = parseOpenClawPluginOnly(content);

    expect(plugin).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('handles actions with complex parameters', () => {
    const content = `---
openclaw-plugin: true
name: Complex Plugin
version: 1.0.0
actions:
  - name: complexAction
    description: Complex action with schema
    parameters:
      input:
        type: object
        properties:
          id: { type: string }
          data: { type: object }
        required: [id]
    returns:
      type: object
      properties:
        success: { type: boolean }
        result: { type: string }
`;

    const { plugin } = parseOpenClawPluginOnly(content);

    expect(plugin).not.toBeNull();
    expect(plugin!.actions[0].parameters).toEqual({
      input: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          data: { type: 'object' },
        },
        required: ['id'],
      },
    });
    expect(plugin!.actions[0].returns).toEqual({
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'string' },
      },
    });
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('migrateOpenClawPlugin edge cases', () => {
  it('handles empty content', () => {
    const result = migrateOpenClawPlugin('');

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles malformed frontmatter gracefully', () => {
    const content = `---
invalid: yaml: [that: is: broken
---
openclaw-plugin: true
name: Test
---
## Tools
Tools here`;

    const result = migrateOpenClawPlugin(content);

    // Should not crash, may fail but handles gracefully
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('errors');
  });

  it('handles plugin with no actions or hooks', () => {
    const content = `---
openclaw-plugin: true
name: Empty Plugin
version: 1.0.0
description: No actions or hooks
`;

    const result = migrateOpenClawPlugin(content);

    expect(result.success).toBe(true);
    expect(result.output).toContain('# Level 1: Metadata');
    expect(result.output).toContain('# Level 2: Instructions');
  });

  it('handles plugin with array permissions (string format)', () => {
    const content = `---
openclaw-plugin: true
name: String Perms Plugin
version: 1.0.0
permissions:
  - network
  - filesystem
actions:
  - name: op
    description: Operation
`;

    const { plugin } = parseOpenClawPluginOnly(content);

    expect(plugin).not.toBeNull();
    expect(plugin!.permissions).toHaveLength(2);
    expect(plugin!.permissions[0].name).toBe('network');
    expect(plugin!.permissions[0].required).toBe(true);
    expect(plugin!.permissions[1].name).toBe('filesystem');
  });

  it('warns about partially supported hooks', () => {
    const content = `---
openclaw-plugin: true
name: Hooked Plugin
version: 1.0.0
hooks:
  - name: beforeAction
    description: Before action hook
  - name: afterAction
    description: After action hook
actions:
  - name: op
    description: Operation
`;

    const result = migrateOpenClawPlugin(content);

    expect(result.success).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Hook 'beforeAction' has limited support")
    );
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Hook 'afterAction' has limited support")
    );
  });

  it('warns about unsupported hooks', () => {
    const content = `---
openclaw-plugin: true
name: Unsupported Hooks Plugin
version: 1.0.0
hooks:
  - name: onNetworkRequest
    description: Network request hook
  - name: onSecurityEvent
    description: Security event hook
actions:
  - name: op
    description: Operation
`;

    const result = migrateOpenClawPlugin(content);

    expect(result.success).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Hook 'onNetworkRequest' is not supported")
    );
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Hook 'onSecurityEvent' is not supported")
    );
  });
});
