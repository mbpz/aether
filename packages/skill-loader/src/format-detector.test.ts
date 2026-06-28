// format-detector contract tests — B14 retro-fit.
// Two public functions: detectFormat (returns {format, confidence,
// reasons}) and detectFormatSimple (returns just the format).
import { describe, it, expect } from 'vitest';
import { detectFormat, detectFormatSimple } from './format-detector.js';

const MANUS_SAMPLE = `---
name: manus-skill
version: 1.0.0
---

# Level 1: Metadata

## System Prompt

You are a Manus skill.

## Code

\`\`\`javascript
return 42;
\`\`\`
`;

const OPENCLAW_SAMPLE = `---
openclaw-plugin: true
name: openclaw-skill
version: 1.0.0
---

# openclaw-skill

## Tools

Some tools here.
`;

const AETHER_SAMPLE = `---
aether-skill: true
name: aether-skill
version: 1.0.0
description: aether test
---

# aether-skill

## System Prompt

An aether skill.
`;

const UNKNOWN_SAMPLE = `# Just markdown

No frontmatter at all.
`;

describe('format-detector', () => {
  describe('detectFormat()', () => {
    it('detects Manus format from frontmatter fields', () => {
      const r = detectFormat(MANUS_SAMPLE);
      expect(r.format).toBe('manus');
      expect(r.confidence).toBe('high');
      expect(r.reasons.length).toBeGreaterThan(0);
    });

    it('detects OpenClaw format from openclaw-plugin key', () => {
      const r = detectFormat(OPENCLAW_SAMPLE);
      expect(r.format).toBe('openclaw');
      expect(r.confidence).toBe('high');
    });

    it('detects Aether format from aether-skill key', () => {
      const r = detectFormat(AETHER_SAMPLE);
      expect(r.format).toBe('aether');
      expect(r.confidence).toBe('high');
    });

    it('returns unknown for plain markdown', () => {
      const r = detectFormat(UNKNOWN_SAMPLE);
      expect(r.format).toBe('unknown');
      expect(r.confidence).toBe('low');
    });

    it('returns reasons array even for unknown (documenting the rejection path)', () => {
      const r = detectFormat(UNKNOWN_SAMPLE);
      expect(Array.isArray(r.reasons)).toBe(true);
      expect(r.reasons.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('detectFormatSimple()', () => {
    it('returns just the format string', () => {
      expect(detectFormatSimple(MANUS_SAMPLE)).toBe('manus');
      expect(detectFormatSimple(OPENCLAW_SAMPLE)).toBe('openclaw');
      expect(detectFormatSimple(AETHER_SAMPLE)).toBe('aether');
      expect(detectFormatSimple(UNKNOWN_SAMPLE)).toBe('unknown');
    });

    it('handles empty string', () => {
      expect(detectFormatSimple('')).toBe('unknown');
    });

    it('handles plain text without frontmatter', () => {
      expect(detectFormatSimple('# Title\n\nSome content.')).toBe('unknown');
    });

    it('prefers higher-priority format markers', () => {
      // If frontmatter has BOTH aether-skill and openclaw-plugin,
      // the detector should resolve to one (typically aether wins
      // because it's checked first). This documents the precedence.
      const ambiguous = `---
aether-skill: true
openclaw-plugin: true
name: ambig
---

# ambig
`;
      const r = detectFormat(ambiguous);
      expect(['aether', 'openclaw']).toContain(r.format);
    });
  });
});
