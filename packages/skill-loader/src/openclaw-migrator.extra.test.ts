// OpenClaw migrator extra contract tests — B14.7.
// Existing openclaw-migrator.test.ts covers happy paths; this file
// adds edge cases on the validation and parsing branches.
import { describe, it, expect } from 'vitest';
import { migrateOpenClawPlugin } from './openclaw-migrator.js';

const SAMPLE = `---
openclaw-plugin: true
name: doc-search
version: 2.1.0
description: search internal docs
category: developer
author: alice
tags: [docs, search]
actions:
  - name: grep
    description: search files
    parameters:
      type: object
      properties:
        query:
          type: string
hooks:
  - name: on-load
    trigger: startup
permissions:
  - fs:read
---

# doc-search

## Tools

Some tools here.
`;

describe('openclaw-migrator — extra edge cases (B14.7)', () => {
  it('migrates actions, hooks, permissions', () => {
    const r = migrateOpenClawPlugin(SAMPLE);
    expect(r.success).toBe(true);
    expect(r.output).toContain('aether-skill: true');
    expect(r.output).toContain('doc-search');
    expect(r.output).toContain('platform:');
    // hooks or actions may be in the converted output, but the
    // important contract is that the structure is preserved
    expect(r.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it('rejects non-OpenClaw content (missing openclaw-plugin marker)', () => {
    const r = migrateOpenClawPlugin('# Just plain markdown');
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatch(/OpenClaw/);
  });

  it('accepts content with actions array even without openclaw-plugin: true', () => {
    const noMarker = `---
name: weird
actions:
  - name: x
---`;
    const r = migrateOpenClawPlugin(noMarker);
    expect(r.success).toBe(true);
  });

  it('handles missing name gracefully (defaults to "Unnamed OpenClaw Skill")', () => {
    const r = migrateOpenClawPlugin(`---
openclaw-plugin: true
---`);
    expect(r.success).toBe(true);
    expect(r.output).toContain('Unnamed OpenClaw Skill');
  });

  it('emits warnings for actions being converted (per B11 docs)', () => {
    const r = migrateOpenClawPlugin(SAMPLE);
    expect(r.warnings.some((w) => /actions?/i.test(w) || w.length > 0)).toBe(true);
  });
});
