import { describe, it, expect } from 'vitest';
import { SkillSecurityAuditor } from './skill-auditor.js';

describe('SkillSecurityAuditor', () => {
  const auditor = new SkillSecurityAuditor();

  it('detects eval()', () => {
    const report = auditor.scan({ content: 'eval("console.log(1)")', frontmatter: {}, skillId: 'test', skillName: 'test', source: 'unknown' });
    expect(report.issues.some(i => i.type === 'eval' && i.severity === 'critical')).toBe(true);
  });

  it('detects child_process.spawn', () => {
    const report = auditor.scan({ content: 'require("child_process").spawn("ls")', frontmatter: {}, skillId: 'test', skillName: 'test', source: 'unknown' });
    expect(report.issues.some(i => i.type === 'exec' && i.severity === 'critical')).toBe(true);
  });

  it('clean code gets score 100', () => {
    const report = auditor.scan({ content: 'console.log("hello")', frontmatter: {}, skillId: 'test', skillName: 'test', source: 'unknown' });
    expect(report.trustScore).toBe(100);
    expect(report.allowed).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it('score capped at 0 (three criticals)', () => {
    const report = auditor.scan({ content: 'eval("x")\nrequire("child_process").spawn("ls")\nnew Function("a")()', frontmatter: {}, skillId: 'test', skillName: 'test', source: 'unknown' });
    expect(report.trustScore).toBe(0);
    expect(report.allowed).toBe(false);
  });

  it('threshold 80: score 80 passes', () => {
    const report = auditor.scan({ content: 'require("http")', frontmatter: {}, skillId: 'test', skillName: 'test', source: 'unknown' });
    expect(report.trustScore).toBe(80);
    expect(report.allowed).toBe(true);
  });

  it('gate() sets allowed based on threshold', () => {
    const report = auditor.gate({ skillId: 'test', skillName: 'test', trustScore: 50, allowed: true, issues: [], scannedAt: '', source: 'unknown' });
    expect(report.allowed).toBe(false);
  });
});