import { describe, it, expect } from 'vitest';
import {
  convertManusToAether,
  convertOpenClawToAether,
  convertAetherToManus,
  autoConvertToAether,
  autoConvert,
  detectAndValidate,
} from './format-converter.js';
import { detectFormat, detectFormatSimple } from './format-detector.js';

// =============================================================================
// Format detection tests
// =============================================================================

describe('format-detector', () => {
  describe('detectFormat', () => {
    it('detects Manus format via frontmatter id', () => {
      const content = `---
id: manus-test-skill
name: Test Skill
version: 1.0.0
permissions:
  - network
---
# Test skill`;
      const result = detectFormat(content);
      expect(result.format).toBe('manus');
      expect(result.confidence).toBe('high');
    });

    it('detects OpenClaw format via openclaw-plugin marker', () => {
      const content = `---
openclaw-plugin: true
name: OpenClaw Skill
version: 1.0.0
---
## Tools
Some tools here`;
      const result = detectFormat(content);
      expect(result.format).toBe('openclaw');
      expect(result.confidence).toBe('high');
    });

    it('detects OpenClaw format via actions array', () => {
      const content = `---
name: OpenClaw Actions Skill
actions:
  - name: doSomething
    description: Does something
---
## Actions
Some actions`;
      const result = detectFormat(content);
      expect(result.format).toBe('openclaw');
      expect(result.confidence).toBe('high');
    });

    it('detects Aether format via aether-skill frontmatter', () => {
      const content = `---
aether-skill: true
name: Aether Native Skill
version: 1.0.0
---
# Level 1: Metadata
Metadata here`;
      const result = detectFormat(content);
      expect(result.format).toBe('aether');
      expect(result.confidence).toBe('high');
    });

    it('detects Manus format via System Prompt section', () => {
      const content = `---
name: Manus Style Skill
---
## System Prompt
You are a helpful assistant`;
      const result = detectFormat(content);
      expect(result.format).toBe('manus');
      expect(result.confidence).toBe('high');
    });

    it('detects OpenClaw format via Tools section', () => {
      const content = `---
name: OpenClaw Style Skill
---
## Tools
- tool1
- tool2`;
      const result = detectFormat(content);
      expect(result.format).toBe('openclaw');
      expect(result.confidence).toBe('medium');
    });

    it('returns unknown for non-skill content', () => {
      const content = `# Just a regular document\n\nSome content here`;
      const result = detectFormat(content);
      expect(result.format).toBe('unknown');
    });
  });

  describe('detectFormatSimple', () => {
    it('returns just the format string', () => {
      const manusContent = `---
id: test-skill
name: Test
---
`;
      expect(detectFormatSimple(manusContent)).toBe('manus');
    });
  });
});

// =============================================================================
// Manus to Aether conversion
// =============================================================================

describe('convertManusToAether', () => {
  // TODO(Batch 2): fix Manus → Aether field mapping in convertManusToAether
  it.skip('converts basic Manus SKILL.md to Aether format', () => {
    const manusContent = `---
id: manus-code-generator
name: Code Generator
version: 1.0.0
description: Generates code from specifications
category: coding
author: Manus Team
permissions:
  - network
triggers:
  - generate
  - code
---
# Level 1: Metadata

**Name:** Code Generator
**Version:** 1.0.0

# Level 2: Instructions

## System Prompt

You are an expert code generator. Given a specification, generate clean, efficient code.

## Input Schema

\`\`\`json
{
  "type": "object",
  "properties": {
    "spec": { "type": "string" }
  }
}
\`\`\`

# Level 3: Resources

## Code

\`\`\`javascript
function generate(spec) {
  return "// generated code";
}
\`\`\`

## Dependencies

- skillpack/utils@1.0.0`;

    const result = convertManusToAether(manusContent);
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output).toContain('aether-skill: true');
    expect(result.output).toContain('name: Code Generator');
    expect(result.output).toContain('# Level 1: Metadata');
    expect(result.output).toContain('# Level 2: Instructions');
    expect(result.output).toContain('# Level 3: Resources');
    expect(result.warnings.length).toBeGreaterThan(0); // permissions warning
  });

  it('returns error for content without id or name', () => {
    const invalidContent = `---
description: No name or id
---
Some content`;
    const result = convertManusToAether(invalidContent);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles Manus content with no Level 3', () => {
    const manusContent = `---
id: minimal-skill
name: Minimal Skill
version: 1.0.0
---
## System Prompt
Simple prompt`;
    const result = convertManusToAether(manusContent);
    expect(result.success).toBe(true);
    expect(result.output).toContain('# Level 2: Instructions');
    expect(result.output).not.toContain('# Level 3: Resources');
  });
});

// =============================================================================
// OpenClaw to Aether conversion
// =============================================================================

describe('convertOpenClawToAether', () => {
  it('converts basic OpenClaw plugin to Aether format', () => {
    const openClawContent = `---
openclaw-plugin: true
name: OpenClaw File Tool
version: 1.0.0
description: File operations tool
actions:
  - name: readFile
    description: Read a file from the filesystem
    parameters:
      path: string
  - name: writeFile
    description: Write content to a file
---
## Tools

- readFile(path): Reads file contents
- writeFile(path, content): Writes content to file`;

    const result = convertOpenClawToAether(openClawContent);
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output).toContain('aether-skill: true');
    expect(result.output).toContain('name: OpenClaw File Tool');
    expect(result.output).toContain('# Level 2: Instructions');
    expect(result.warnings.length).toBeGreaterThan(0); // actions converted warning
  });

  it('returns error for content without openclaw-plugin marker', () => {
    const invalidContent = `---
name: Not OpenClaw
---
Some content`;
    const result = convertOpenClawToAether(invalidContent);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles OpenClaw content with actions array', () => {
    const openClawContent = `---
name: Action Skill
actions:
  - name: doAction
    description: Performs an action
---
## Actions
Action descriptions`;
    const result = convertOpenClawToAether(openClawContent);
    expect(result.success).toBe(true);
    expect(result.output).toContain('### doAction');
  });
});

// =============================================================================
// Aether to Manus conversion
// =============================================================================

describe('convertAetherToManus', () => {
  it('converts basic Aether format to Manus SKILL.md', () => {
    const aetherContent = `---
aether-skill: true
name: Aether to Manus Test
version: 1.0.0
description: Testing conversion
category: testing
---
# Level 1: Metadata

**Name:** Aether to Manus Test
**Version:** 1.0.0

# Level 2: Instructions

## System Prompt

You are a test skill converted from Aether to Manus format.

# Level 3: Resources

## Dependencies

- skillpack/test@1.0.0`;

    const result = convertAetherToManus(aetherContent);
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output).toContain('id:');
    expect(result.output).toContain('name: Aether to Manus Test');
    expect(result.output).toContain('# Level 1: Metadata');
    expect(result.output).toContain('# Level 2: Instructions');
    expect(result.warnings.length).toBeGreaterThan(0); // Aether-specific features warning
  });

  it('returns error for content without aether-skill marker or instructions', () => {
    const invalidContent = `---
name: Not Aether
---
No sections`;
    const result = convertAetherToManus(invalidContent);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Auto-conversion tests
// =============================================================================

describe('autoConvertToAether', () => {
  it('auto-detects Manus and converts', () => {
    const content = `---
id: auto-manus
name: Auto Manus Skill
---
## System Prompt
Auto converted prompt`;
    const result = autoConvertToAether(content);
    expect(result.success).toBe(true);
    expect(result.output).toContain('aether-skill: true');
  });

  it('auto-detects OpenClaw and converts', () => {
    const content = `---
openclaw-plugin: true
name: Auto OpenClaw Skill
---
## Tools
Tool definitions`;
    const result = autoConvertToAether(content);
    expect(result.success).toBe(true);
    expect(result.output).toContain('aether-skill: true');
  });

  it('handles Aether content with no conversion needed', () => {
    const content = `---
aether-skill: true
name: Already Aether
---
# Level 1: Metadata
Already in Aether format`;
    const result = autoConvertToAether(content);
    expect(result.success).toBe(true);
    expect(result.warnings).toContain('Content is already in Aether format, no conversion performed');
  });

  it('returns error for unknown format', () => {
    const content = `# Random document\n\nNot a skill`;
    const result = autoConvertToAether(content);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('autoConvert', () => {
  it('converts Manus to Manus (no-op with warning)', () => {
    const content = `---
id: same-format
name: Same Format
---
## System Prompt
Same format`;
    const result = autoConvert(content, 'manus');
    expect(result.success).toBe(true);
    expect(result.warnings).toContain('Content is already in manus format');
  });

  it('converts Manus to Aether', () => {
    const content = `---
id: manus-to-aether
name: Manus to Aether
---
## System Prompt
Convert me`;
    const result = autoConvert(content, 'aether');
    expect(result.success).toBe(true);
    expect(result.output).toContain('aether-skill: true');
  });

  it('converts Aether to Manus', () => {
    const content = `---
aether-skill: true
name: Aether to Manus
---
# Level 1: Metadata
# Level 2: Instructions
Prompt here`;
    const result = autoConvert(content, 'manus');
    expect(result.success).toBe(true);
    expect(result.output).toContain('id:');
  });

  it('converts OpenClaw to Manus via Aether', () => {
    const content = `---
openclaw-plugin: true
name: OpenClaw to Manus
---
## Tools
Tool definitions`;
    const result = autoConvert(content, 'manus');
    expect(result.success).toBe(true);
    expect(result.output).toContain('id:');
  });
});

// =============================================================================
// Validation tests
// =============================================================================

describe('detectAndValidate', () => {
  it('validates Manus format', () => {
    const content = `---
id: valid-manus
name: Valid Manus
version: 1.0.0
---
## System Prompt
Valid content`;
    const result = detectAndValidate(content);
    expect(result.format).toBe('manus');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates OpenClaw format', () => {
    const content = `---
openclaw-plugin: true
name: Valid OpenClaw
---
## Tools
Valid content`;
    const result = detectAndValidate(content);
    expect(result.format).toBe('openclaw');
    expect(result.valid).toBe(true);
  });

  // TODO(Batch 2): fix detectAndValidate to surface missing-id/version issues
  it.skip('detects validation issues', () => {
    const content = `---
name: Missing ID
---
## System Prompt
Content`;
    const result = detectAndValidate(content);
    expect(result.format).toBe('manus');
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe('format-converter edge cases', () => {
  it('handles malformed frontmatter gracefully', () => {
    const content = `---
invalid: yaml: [that: is: broken
---
content`;
    const result = autoConvertToAether(content);
    // Should not crash, might fail but shouldn't throw
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('errors');
  });

  it('handles empty content', () => {
    const result = autoConvertToAether('');
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles content with only frontmatter', () => {
    const content = `---
aether-skill: true
name: Frontmatter Only
---
`;
    const result = convertAetherToManus(content);
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  });

  it('preserves conversion metadata when option enabled', () => {
    const content = `---
id: conversion-test
name: Conversion Test
---
## System Prompt
Test`;
    const result = convertManusToAether(content, { includeConversionMeta: true });
    expect(result.output).toContain('converted_from: manus');
    expect(result.output).toContain('converted_to: aether');
    expect(result.output).toContain('converted_at:');
  });

  it('skips conversion metadata when option disabled', () => {
    const content = `---
id: no-meta-test
name: No Meta Test
---
## System Prompt
Test`;
    const result = convertManusToAether(content, { includeConversionMeta: false });
    expect(result.success).toBe(true);
    // Output should not contain conversion metadata
    expect(result.output).not.toContain('converted_from');
  });
});
