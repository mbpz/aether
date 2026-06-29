// Manus importer contract tests — B14.6.
// Covers parseManusPlaybook, validatePlaybook, isManusPlaybook,
// importManusPlaybook.
import { describe, it, expect } from 'vitest';
import {
  parseManusPlaybook,
  importManusPlaybook,
  validatePlaybook,
  isManusPlaybook,
} from './manus-importer.js';

const PLAYBOOK = `---
playbook: true
name: Incident Response
version: 1.0.0
description: Demo playbook
trigger: alert_received
variables:
  - name: service
    description: Service name
    required: true
env_vars:
  PAGERDUTY_KEY: secret-ref
---

steps:
  - id: triage
    name: Triage
    description: Check logs and metrics
    action: inspect
    timeout: 60
  - id: notify
    name: Notify
    description: Notify on-call
    action: notify
    conditions:
      - severity == high
`;

describe('manus-importer', () => {
  describe('isManusPlaybook', () => {
    it('returns true for playbook frontmatter', () => {
      expect(isManusPlaybook(PLAYBOOK)).toBe(true);
    });

    it('returns false for plain markdown', () => {
      expect(isManusPlaybook('# Just Markdown\n')).toBe(false);
    });
  });

  describe('parseManusPlaybook', () => {
    it('parses name/version/description/triggers', () => {
      const p = parseManusPlaybook(PLAYBOOK)!;
      expect(p.name).toBe('Incident Response');
      expect(p.version).toBe('1.0.0');
      expect(p.description).toBe('Demo playbook');
      expect(p.triggers).toContain('alert_received');
    });

    it('parses steps from YAML body', () => {
      const p = parseManusPlaybook(PLAYBOOK)!;
      expect(p.steps.length).toBe(2);
      expect(p.steps[0].id).toBe('triage');
      expect(p.steps[1].conditions).toEqual(['severity == high']);
    });

    it('parses variables and env vars', () => {
      const p = parseManusPlaybook(PLAYBOOK)!;
      expect(p.variables?.[0].name).toBe('service');
      expect(p.variables?.[0].required).toBe(true);
      expect(p.env_vars?.PAGERDUTY_KEY).toBe('secret-ref');
    });

    it('returns null for non-playbook content', () => {
      expect(parseManusPlaybook('# hello')).toBeNull();
    });
  });

  describe('validatePlaybook', () => {
    it('accepts a valid playbook', () => {
      const p = parseManusPlaybook(PLAYBOOK)!;
      expect(validatePlaybook(p).valid).toBe(true);
    });

    it('rejects a playbook with no name', () => {
      const p = parseManusPlaybook(PLAYBOOK)!;
      p.name = '';
      const r = validatePlaybook(p);
      expect(r.valid).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    });

    it('rejects a playbook with no steps', () => {
      const p = parseManusPlaybook(PLAYBOOK)!;
      p.steps = [];
      const r = validatePlaybook(p);
      expect(r.valid).toBe(false);
    });
  });

  describe('importManusPlaybook', () => {
    it('converts a playbook to Aether SKILL.md format', () => {
      const r = importManusPlaybook(PLAYBOOK);
      expect(r.success).toBe(true);
      expect(r.output).toContain('aether-skill: true');
      expect(r.output).toContain('name: Incident Response');
      expect(r.output).toContain('# Level 2: Instructions');
      expect(r.output).toContain('Triage');
    });

    it('returns failure for non-playbook content', () => {
      const r = importManusPlaybook('# plain markdown');
      expect(r.success).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    });

    it('includes env vars in the converted output', () => {
      const r = importManusPlaybook(PLAYBOOK);
      expect(r.success).toBe(true);
      expect(r.output).toContain('PAGERDUTY_KEY');
    });
  });
});
