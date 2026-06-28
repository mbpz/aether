// SkillMarketplace contract tests — B14 retro-fit.
// The marketplace has only one write path: register(skillPath) which
// reads a SKILL.md file, parses it, audits it, and (if allowed)
// adds it to the in-memory index. The other API surface (list,
// search, getById, rate, remove) operates on the in-memory index.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SkillMarketplace } from './marketplace.js';

const SKILL_MD = (overrides: {
  name?: string;
  description?: string;
  tags?: string[];
  category?: string;
} = {}) => `---
name: ${overrides.name ?? 'test-skill'}
version: 1.0.0
description: ${overrides.description ?? 'A test skill'}
category: ${overrides.category ?? 'productivity'}
author: alice
tags:
${(overrides.tags ?? ['testing', 'demo']).map((t) => `  - ${t}`).join('\n')}
---

# ${overrides.name ?? 'test-skill'}

## System Prompt

A test prompt.

## Code

\`\`\`javascript
return { ok: true, output: 42 };
\`\`\`
`;

function makeMarketplace(workdir: string) {
  return new SkillMarketplace(workdir);
}

describe('SkillMarketplace', () => {
  let workdir: string;
  let mp: SkillMarketplace;
  let skillPath: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'aether-marketplace-'));
    mp = makeMarketplace(workdir);
    skillPath = join(workdir, 'SKILL.md');
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  describe('empty state', () => {
    it('list() returns [] on a fresh instance', () => {
      expect(mp.list()).toEqual([]);
    });
  });

  describe('register()', () => {
    it('reads a SKILL.md file and adds the manifest', async () => {
      writeFileSync(skillPath, SKILL_MD({ name: 'csv-parser' }));
      const m = await mp.register(skillPath);
      expect(m.name).toBe('csv-parser');
      expect(mp.list().length).toBe(1);
    });

    it('persists the manifest and reloads on a new instance', async () => {
      writeFileSync(skillPath, SKILL_MD({ name: 'persist-1' }));
      await mp.register(skillPath);
      const mp2 = makeMarketplace(workdir);
      const all = mp2.list();
      expect(all.length).toBe(1);
      expect(all[0].name).toBe('persist-1');
    });
  });

  describe('search()', () => {
    beforeEach(async () => {
      writeFileSync(join(workdir, 'csv.md'), SKILL_MD({ name: 'csv-parser', description: 'parse CSV', tags: ['data', 'csv'] }));
      writeFileSync(join(workdir, 'json.md'), SKILL_MD({ name: 'json-formatter', description: 'format JSON', tags: ['data', 'json'] }));
      writeFileSync(join(workdir, 'git.md'), SKILL_MD({ name: 'git-status', description: 'show git status', tags: ['dev'] }));
      await mp.register(join(workdir, 'csv.md'));
      await mp.register(join(workdir, 'json.md'));
      await mp.register(join(workdir, 'git.md'));
    });

    it('matches by name case-insensitively', async () => {
      const r = mp.search('csv');
      expect(r.length).toBe(1);
      expect(r[0].name).toBe('csv-parser');
    });

    it('matches by tag', () => {
      const r = mp.search('data');
      expect(r.length).toBe(2);
    });

    it('matches by description', () => {
      const r = mp.search('show');
      expect(r.length).toBe(1);
    });

    it('returns [] for no match', () => {
      expect(mp.search('xyzzy_nothing_matches')).toEqual([]);
    });

    it('empty query returns everything', () => {
      expect(mp.search('').length).toBe(3);
    });
  });

  describe('getById()', () => {
    it('returns null for unknown id', () => {
      expect(mp.getById('nope')).toBeNull();
    });

    it('returns the registered skill by id', async () => {
      writeFileSync(skillPath, SKILL_MD({ name: 'lookable' }));
      const m = await mp.register(skillPath);
      expect(mp.getById(m.id)?.name).toBe('lookable');
    });
  });

  describe('rate()', () => {
    it('throws MarketplaceError for unknown id', () => {
      expect(() => mp.rate('nope', 5)).toThrow(/Skill not found/);
    });

    it('records a rating and returns the new average', async () => {
      writeFileSync(skillPath, SKILL_MD({ name: 'rateable' }));
      const m = await mp.register(skillPath);
      const avg = mp.rate(m.id, 4);
      expect(avg).toBeGreaterThan(0);
      expect(avg).toBeLessThanOrEqual(4);
    });
  });

  describe('remove()', () => {
    it('removes a skill by id', async () => {
      writeFileSync(skillPath, SKILL_MD({ name: 'removable' }));
      const m = await mp.register(skillPath);
      mp.remove(m.id);
      expect(mp.getById(m.id)).toBeNull();
    });
  });
});
