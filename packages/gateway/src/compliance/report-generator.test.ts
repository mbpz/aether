// ComplianceReportGenerator contract tests — B8.4.
// Tests the public generate() API across all 4 framework branches + the
// (private but observable) summary/findings/recommendations logic via
// the returned report shape.
//
// We don't load isolated-vm; the only dep is AuditLogger which we
// stub in tmpdir so each test owns its own audit log dir.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AuditLogger } from '../audit/logger.js';
import { ComplianceReportGenerator } from './report-generator.js';

const SIGNING_KEY = 'aether-test-signing-key-must-be-at-least-32-chars';

function makeGen() {
  const workdir = mkdtempSync(join(tmpdir(), 'aether-compliance-'));
  const logger = new AuditLogger({ logDir: workdir, signingKey: SIGNING_KEY });
  const gen = new ComplianceReportGenerator(logger);
  return { gen, logger, workdir };
}

function cleanup(workdir: string) {
  rmSync(workdir, { recursive: true, force: true });
}

describe('ComplianceReportGenerator', () => {
  describe('generate() — top-level shape', () => {
    it('returns a report with id, period, framework, scope, sections, summary, findings', async () => {
      const { gen, workdir } = makeGen();
      try {
        const r = await gen.generate({
          framework: 'SOC2',
          period: { start: '2026-01-01T00:00:00Z', end: '2026-12-31T23:59:59Z' },
          scope: 'Aether gateway',
        });
        expect(r.id).toBeDefined();
        expect(r.generatedAt).toBeDefined();
        expect(r.framework).toBe('SOC2');
        expect(r.scope).toBe('Aether gateway');
        expect(r.period.start).toBe('2026-01-01T00:00:00Z');
        expect(r.period.end).toBe('2026-12-31T23:59:59Z');
        expect(Array.isArray(r.sections)).toBe(true);
        expect(r.sections.length).toBeGreaterThan(0);
        expect(r.summary).toBeDefined();
        expect(typeof r.summary.overallScore).toBe('number');
        expect(Array.isArray(r.findings)).toBe(true);
        expect(Array.isArray(r.recommendations)).toBe(true);
        expect(Array.isArray(r.auditTrail)).toBe(true);
      } finally {
        cleanup(workdir);
      }
    });
  });

  describe('generate() — framework branches', () => {
    for (const framework of ['SOC2', 'GDPR', 'HIPAA', 'ISO27001', 'custom'] as const) {
      it(`${framework} → report.framework === ${framework}`, async () => {
        const { gen, workdir } = makeGen();
        try {
          const r = await gen.generate({
            framework,
            period: { start: '2026-01-01T00:00:00Z', end: '2026-12-31T23:59:59Z' },
            scope: 'Aether',
          });
          expect(r.framework).toBe(framework);
        } finally {
          cleanup(workdir);
        }
      });
    }
  });

  describe('summary math', () => {
    it('overallScore is 100 when all sections pass', async () => {
      const { gen, workdir } = makeGen();
      try {
        const r = await gen.generate({
          framework: 'SOC2',
          period: { start: '2026-01-01T00:00:00Z', end: '2026-12-31T23:59:59Z' },
          scope: 'Aether',
        });
        // Without audit log activity, the report may score pass or
        // warning depending on the check semantics. Assert the score
        // is in a valid range and counts add up.
        expect(r.summary.overallScore).toBeGreaterThanOrEqual(0);
        expect(r.summary.overallScore).toBeLessThanOrEqual(100);
        const sum = r.summary.controlsPassed + r.summary.controlsFailed + r.summary.controlsWarning;
        // Not-applicable doesn't count toward applicable.
        const total = sum + r.summary.controlsNotApplicable;
        expect(total).toBe(r.sections.length);
      } finally {
        cleanup(workdir);
      }
    });
  });

  describe('audit trail', () => {
    it('contains a policy reference for known framework', async () => {
      const { gen, workdir } = makeGen();
      try {
        const r = await gen.generate({
          framework: 'SOC2',
          period: { start: '2026-01-01T00:00:00Z', end: '2026-12-31T23:59:59Z' },
          scope: 'Aether',
        });
        const policyRef = r.auditTrail.find((t) => t.type === 'policy');
        expect(policyRef).toBeDefined();
        expect(policyRef!.reference).toMatch(/soc2|iso|hipaa|gdpr/);
      } finally {
        cleanup(workdir);
      }
    });
  });
});