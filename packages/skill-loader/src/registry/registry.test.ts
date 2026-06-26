// SkillRegistry contract tests — B8.3 retro-fit.
// Test progressive disclosure (Level 1/2/3) + search + audit.
import { describe, it, expect } from 'vitest';
import { SkillRegistry } from './registry.js';
import { SkillParser } from '../parser/skill-parser.js';

const SAMPLE_A = `---
name: code-gen
version: 1.0.0
description: generate code from specs
tags: [code, gen]
---

# code-gen

## System Prompt

You generate code.

## Code

\`\`\`javascript
return 42;
\`\`\`
`;

const SAMPLE_B = `---
name: doc-search
version: 2.1.0
description: search internal docs
tags: [docs, search]
---

# doc-search

## System Prompt

You search docs.
`;

function makeRegistry() {
  const r = new SkillRegistry();
  const p = new SkillParser();
  r.register(p.parseFromContent(SAMPLE_A));
  r.register(p.parseFromContent(SAMPLE_B));
  return r;
}

function findSkill(r: SkillRegistry, name: string): { id: string; name: string } | null {
  const meta = r.listLevel1().find((m) => m.name === name);
  if (!meta) return null;
  // Reconstruct the registry id from the metadata. listLevel1 doesn't
  // include id, so look it up via getLevel3 returning the full record.
  const full = r.listLevel1().find((m) => m.name === name);
  if (!full) return null;
  // The registry stores by an internal id; we need to find it.
  // Trick: search by name to find a candidate, then probe.
  // Since this is test code and there are 2 known skills, we can
  // brute-force.
  for (const candidate of r.listLevel1()) {
    if (candidate.name === name) {
      // Use getLevel3 probe to detect — it returns null for unknown id.
      // We don't have the id, so use the auditSkill path which also
      // returns null for unknown. Use a different probe: re-register
      // and capture from a known mapping.
    }
  }
  // Fallback: use any registered skill via the private Map. We can't
  // do that from outside. Instead, build a helper.
  return null;
}

// Build a name → id lookup at registration time.
function makeRegistryWithIds() {
  const r = new SkillRegistry();
  const p = new SkillParser();
  const sA = p.parseFromContent(SAMPLE_A);
  const sB = p.parseFromContent(SAMPLE_B);
  r.register(sA);
  r.register(sB);
  // The registry stores skills by an id derived from the parsed
  // skill.id, which is itself deterministic given the parsed name
  // and timestamp. To find by name, scan via getLevel3 — but id is
  // not exposed. Use search() to map name → id by matching the
  // meta returned in progressive disclosure. The id is on the full
  // record (level3); we need it. Simpler: re-parse and find by hash.
  // Since id format is `skill-${name}-${Date.now()}`, two consecutive
  // registrations give different ids. We don't need exact ids — we
  // just need any registered skill. Use a private-Map accessor below.
  // Hack: register with a tagged variant of SAMPLE_A so its content
  // differs; then look up by scanning all known ids via getLevel3
  // repeatedly is impossible without an iteration helper.
  // Instead, expose: we know that for tests we can just probe by
  // calling auditAll() and matching skillName.
  return { r, sA, sB };
}

describe('SkillRegistry', () => {
  describe('register + listLevel1', () => {
    it('register stores skills reachable via listLevel1', () => {
      const r = new SkillRegistry();
      const p = new SkillParser();
      r.register(p.parseFromContent(SAMPLE_A));
      expect(r.listLevel1().length).toBe(1);
    });
  });

  describe('progressive disclosure', () => {
    it('getLevel3 returns the full skill by id', () => {
      const r = new SkillRegistry();
      const p = new SkillParser();
      const s = p.parseFromContent(SAMPLE_A);
      r.register(s);
      const l3 = r.getLevel3(s.id);
      expect(l3).not.toBeNull();
      expect(l3!.level1.name).toBe('code-gen');
      expect(l3!.level3?.code).toContain('return 42');
    });

    it('getLevel2 returns null when level2 was not parsed', () => {
      // doc-search has no ## Code section so level3 is undefined,
      // but it has System Prompt → level2 is defined.
      const r = new SkillRegistry();
      const p = new SkillParser();
      const s = p.parseFromContent(SAMPLE_B);
      r.register(s);
      const l2 = r.getLevel2(s.id);
      expect(l2).not.toBeNull();
      expect(l2!.level1.name).toBe('doc-search');
      expect(l2!.level2).toBeDefined();
      // No level3 in the projection.
      expect((l2 as unknown as { level3?: unknown }).level3).toBeUndefined();
    });

    it('getLevel2 / getLevel3 return null for unknown id', () => {
      const r = new SkillRegistry();
      expect(r.getLevel2('nope')).toBeNull();
      expect(r.getLevel3('nope')).toBeNull();
    });
  });

  describe('search', () => {
    it('matches name case-insensitively', () => {
      const r = new SkillRegistry();
      const p = new SkillParser();
      r.register(p.parseFromContent(SAMPLE_A));
      r.register(p.parseFromContent(SAMPLE_B));
      const r1 = r.search('CODE');
      expect(r1.length).toBe(1);
      expect(r1[0].name).toBe('code-gen');
    });

    it('matches description text', () => {
      const r = new SkillRegistry();
      const p = new SkillParser();
      r.register(p.parseFromContent(SAMPLE_B));
      const r1 = r.search('internal');
      expect(r1.length).toBe(1);
      expect(r1[0].name).toBe('doc-search');
    });

    it('returns empty array when no match', () => {
      const r = new SkillRegistry();
      expect(r.search('xyzzy_nothing_matches')).toEqual([]);
    });
  });

  describe('auditSkill', () => {
    it('returns an AuditReport for a registered skill', () => {
      const r = new SkillRegistry();
      const p = new SkillParser();
      const s = p.parseFromContent(SAMPLE_A);
      r.register(s);
      const report = r.auditSkill(s.id);
      expect(report).not.toBeNull();
      expect(report!.skillId).toBe(s.id);
    });

    it('returns null for unknown id', () => {
      const r = new SkillRegistry();
      expect(r.auditSkill('nope')).toBeNull();
    });
  });
});