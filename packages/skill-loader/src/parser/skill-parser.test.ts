// SkillParser contract tests — B8.3 retro-fit. parseFromContent 路径
// (parseFromFile 已经在 integration test 覆盖过 tmp file）。
import { describe, it, expect } from 'vitest';
import { SkillParser } from './skill-parser.js';

const SAMPLE = `---
name: test-skill
version: 1.2.3
description: A test skill
category: testing
author: tester
tags: [a, b]
triggers:
  - run
  - test
---

# test-skill

## System Prompt

You are a test skill.

## Code

\`\`\`javascript
return 42;
\`\`\`
`;

const SAMPLE_WITH_DEPS = SAMPLE + `
## Dependencies

- skillpack/utils@1.0.0
`;

describe('SkillParser', () => {
  describe('parseFromContent', () => {
    it('extracts frontmatter fields', () => {
      const p = new SkillParser();
      const s = p.parseFromContent(SAMPLE, 'inline');
      expect(s.id).toBeDefined();
      expect(s.level1.name).toBe('test-skill');
      expect(s.level1.version).toBe('1.2.3');
      expect(s.level1.description).toBe('A test skill');
      expect(s.level1.category).toBe('testing');
      expect(s.level1.author).toBe('tester');
      expect(s.level1.tags).toEqual(['a', 'b']);
    });

    it('extracts Level 2 systemPrompt', () => {
      const p = new SkillParser();
      const s = p.parseFromContent(SAMPLE);
      expect(s.level2).toBeDefined();
      expect(s.level2!.systemPrompt).toContain('test skill');
      expect(s.level2!.triggers).toEqual(['run', 'test']);
    });

    it('extracts Level 3 code block', () => {
      const p = new SkillParser();
      const s = p.parseFromContent(SAMPLE);
      expect(s.level3).toBeDefined();
      expect(s.level3!.code).toContain('return 42');
    });

    it('extracts Level 3 dependencies from section', () => {
      const p = new SkillParser();
      const s = p.parseFromContent(SAMPLE_WITH_DEPS);
      expect(s.level3).toBeDefined();
      expect(s.level3!.dependencies).toEqual(['skillpack/utils@1.0.0']);
    });

    it('defaults name from H1 title when frontmatter omits it', () => {
      const p = new SkillParser();
      const s = p.parseFromContent(`# My-Skill\n\n## System Prompt\nhello\n`, 'inline');
      expect(s.level1.name).toBe('My-Skill');
    });

    it('falls back to "Unknown Skill" when no name + no title', () => {
      const p = new SkillParser();
      const s = p.parseFromContent(`## System Prompt\nhello\n`, 'inline');
      expect(s.level1.name).toBe('Unknown Skill');
    });

    it('handles missing Level 2 (no system prompt section)', () => {
      const p = new SkillParser();
      const s = p.parseFromContent(`---\nname: minimal\n---\n# minimal\n`);
      expect(s.level2).toBeUndefined();
    });

    it('defaults version to 1.0.0 when missing', () => {
      const p = new SkillParser();
      const s = p.parseFromContent(`---\nname: vless\n---\n`);
      expect(s.level1.version).toBe('1.0.0');
    });
  });
});