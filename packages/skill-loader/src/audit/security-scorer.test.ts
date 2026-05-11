import { describe, it, expect } from 'vitest';
import { SecurityScorer, scoreSecurity } from './security-scorer.js';

describe('SecurityScorer', () => {
  const scorer = new SecurityScorer();

  describe('networkSafety', () => {
    it('detects hardcoded IPv4 addresses', () => {
      const result = scorer.score({ skillId: 'test', content: 'const api = "https://203.0.113.50:8080/api"' });
      expect(result.breakdown.networkSafety).toBeLessThan(100);
      expect(result.flags.some(f => f.category === 'networkSafety' && f.severity === 'high')).toBe(true);
    });

    it('detects DNS exfiltration patterns', () => {
      const result = scorer.score({ skillId: 'test', content: 'const host = "aGVsbG8gd29ybGQxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMS5jb20"' });
      expect(result.breakdown.networkSafety).toBeLessThan(60);
      expect(result.flags.some(f => f.category === 'networkSafety' && f.severity === 'critical')).toBe(true);
    });

    it('clean network code gets score 100', () => {
      const result = scorer.score({ skillId: 'test', content: 'console.log("hello world")' });
      expect(result.breakdown.networkSafety).toBe(100);
    });

    it('detects external IP services', () => {
      const result = scorer.score({ skillId: 'test', content: 'const ip = await fetch("https://api.ipify.org")' });
      expect(result.breakdown.networkSafety).toBeLessThan(100);
    });
  });

  describe('execSafety', () => {
    it('detects eval()', () => {
      const result = scorer.score({ skillId: 'test', content: 'eval("console.log(1)")' });
      expect(result.breakdown.execSafety).toBe(70); // -30 for critical
      expect(result.flags.some(f => f.category === 'execSafety' && f.severity === 'critical')).toBe(true);
    });

    it('detects child_process.spawn', () => {
      const result = scorer.score({ skillId: 'test', content: 'require("child_process").spawn("ls")' });
      expect(result.breakdown.execSafety).toBe(70);
    });

    it('detects new Function()', () => {
      const result = scorer.score({ skillId: 'test', content: 'const fn = new Function("return 1")' });
      expect(result.breakdown.execSafety).toBe(70);
    });

    it('detects spawnSync', () => {
      const result = scorer.score({ skillId: 'test', content: 'child_process.spawnSync("ls")' });
      expect(result.breakdown.execSafety).toBe(70);
    });

    it('clean exec code gets score 100', () => {
      const result = scorer.score({ skillId: 'test', content: 'console.log("hello")' });
      expect(result.breakdown.execSafety).toBe(100);
    });
  });

  describe('dataIsolation', () => {
    it('detects hardcoded passwords', () => {
      const result = scorer.score({ skillId: 'test', content: 'const dbPassword = "super_secret_123"' });
      expect(result.breakdown.dataIsolation).toBeLessThan(100);
    });

    it('detects hardcoded API keys', () => {
      const result = scorer.score({ skillId: 'test', content: 'const apiKey = "sk-1234567890abcdefghijklmnop"' });
      expect(result.breakdown.dataIsolation).toBe(70); // -30 for critical
    });

    it('detects AWS keys', () => {
      const result = scorer.score({ skillId: 'test', content: 'AWS_ACCESS_KEY_ID="AKIAIOSFODNN7EXAMPLE"' });
      expect(result.breakdown.dataIsolation).toBe(70);
    });

    it('detects GitHub tokens', () => {
      const result = scorer.score({ skillId: 'test', content: 'const githubToken = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"' });
      expect(result.breakdown.dataIsolation).toBe(85); // -15 for high
    });

    it('clean data code gets score 100', () => {
      const result = scorer.score({ skillId: 'test', content: 'console.log("hello")' });
      expect(result.breakdown.dataIsolation).toBe(100);
    });
  });

  describe('inputValidation', () => {
    it('detects innerHTML assignment', () => {
      const result = scorer.score({ skillId: 'test', content: 'element.innerHTML = userInput' });
      expect(result.breakdown.inputValidation).toBe(85); // -15 for high
    });

    it('detects SQL concatenation', () => {
      const result = scorer.score({ skillId: 'test', content: 'const query = "SELECT * FROM users WHERE id = " + userId' });
      expect(result.breakdown.inputValidation).toBe(70); // -30 for critical
    });

    it('detects eval with user input', () => {
      const result = scorer.score({ skillId: 'test', content: 'eval(req.body.code)' });
      expect(result.breakdown.inputValidation).toBe(70);
    });

    it('clean input code gets score 100', () => {
      const result = scorer.score({ skillId: 'test', content: 'console.log("hello")' });
      expect(result.breakdown.inputValidation).toBe(100);
    });
  });

  describe('dependencySafety', () => {
    it('detects child_process import', () => {
      const result = scorer.score({ skillId: 'test', content: 'const { spawn } = require("child_process")' });
      expect(result.breakdown.dependencySafety).toBe(85); // -15 for high
    });

    it('detects os module import', () => {
      const result = scorer.score({ skillId: 'test', content: 'const os = require("os")' });
      expect(result.breakdown.dependencySafety).toBe(95); // -5 for medium
    });

    it('detects dns module import', () => {
      const result = scorer.score({ skillId: 'test', content: 'const dns = require("dns")' });
      expect(result.breakdown.dependencySafety).toBe(85); // -15 for high
    });

    it('clean dependency code gets score 100', () => {
      const result = scorer.score({ skillId: 'test', content: 'console.log("hello")' });
      expect(result.breakdown.dependencySafety).toBe(100);
    });
  });

  describe('overall scoring', () => {
    it('clean skill gets overall score 100', () => {
      const result = scorer.score({ skillId: 'test', content: 'console.log("hello world")' });
      expect(result.overall).toBe(100);
      expect(result.recommendation).toBe('approve');
    });

    it('multiple critical issues results in rejection', () => {
      const result = scorer.score({
        skillId: 'test',
        content: `
          eval("dangerous")
          require("child_process").spawn("rm -rf")
          const key = "sk-1234567890abcdefghijklmnop"
          const ip = "https://203.0.113.50/api"
        `,
      });
      expect(result.overall).toBeLessThan(60);
      expect(result.recommendation).toBe('reject');
    });

    it('moderate issues result in review', () => {
      const result = scorer.score({
        skillId: 'test',
        content: `
          const os = require("os")
          element.innerHTML = userData
          require("http")
        `,
      });
      expect(result.overall).toBeGreaterThanOrEqual(60);
      expect(result.overall).toBeLessThan(80);
      expect(result.recommendation).toBe('review');
    });

    it('score respects thresholds - approve at 80+', () => {
      const result = scorer.score({
        skillId: 'test',
        content: 'const os = require("os")', // -5 points, should get ~95 overall
      });
      expect(result.overall).toBeGreaterThanOrEqual(80);
      expect(result.recommendation).toBe('approve');
    });

    it('score capped at 0', () => {
      const result = scorer.score({
        skillId: 'test',
        content: `
          eval("1")
          eval("2")
          eval("3")
          eval("4")
          eval("5")
        `,
      });
      expect(result.overall).toBe(0);
    });
  });

  describe('recommendations', () => {
    it('returns approve for score 80-100', () => {
      const result = scorer.score({ skillId: 'test', content: 'console.log("clean")' });
      expect(result.recommendation).toBe('approve');
      expect(result.overall).toBeGreaterThanOrEqual(80);
    });

    it('returns review for score 60-79', () => {
      const result = scorer.score({ skillId: 'test', content: 'const os = require("os")' });
      expect(result.recommendation).toBe('review');
      expect(result.overall).toBeGreaterThanOrEqual(60);
      expect(result.overall).toBeLessThan(80);
    });

    it('returns reject for score below 60', () => {
      const result = scorer.score({ skillId: 'test', content: 'eval("dangerous")' });
      expect(result.recommendation).toBe('reject');
      expect(result.overall).toBeLessThan(60);
    });
  });

  describe('flag details', () => {
    it('includes location information', () => {
      const result = scorer.score({ skillId: 'test', content: 'const x = eval("test")' });
      const evalFlag = result.flags.find(f => f.category === 'execSafety');
      expect(evalFlag).toBeDefined();
      expect(evalFlag!.location).toMatch(/line \d+/);
    });

    it('includes suggestion for each flag', () => {
      const result = scorer.score({ skillId: 'test', content: 'eval("test")' });
      const evalFlag = result.flags.find(f => f.category === 'execSafety');
      expect(evalFlag!.suggestion.length).toBeGreaterThan(0);
    });

    it('includes severity level', () => {
      const result = scorer.score({ skillId: 'test', content: 'eval("test")' });
      const evalFlag = result.flags.find(f => f.category === 'execSafety');
      expect(['critical', 'high', 'medium', 'low']).toContain(evalFlag!.severity);
    });
  });

  describe('Python detection', () => {
    it('detects os import in Python', () => {
      const result = scorer.score({
        skillId: 'test',
        content: 'import os',
        language: 'python',
      });
      expect(result.breakdown.dependencySafety).toBeLessThan(100);
    });

    it('detects subprocess import in Python', () => {
      const result = scorer.score({
        skillId: 'test',
        content: 'import subprocess',
        language: 'python',
      });
      expect(result.breakdown.dependencySafety).toBe(85);
    });

    it('detects pickle import in Python (critical)', () => {
      const result = scorer.score({
        skillId: 'test',
        content: 'import pickle',
        language: 'python',
      });
      expect(result.breakdown.dependencySafety).toBe(70);
    });

    it('detects socket import in Python', () => {
      const result = scorer.score({
        skillId: 'test',
        content: 'import socket',
        language: 'python',
      });
      expect(result.breakdown.dependencySafety).toBe(85);
    });
  });

  describe('Java detection', () => {
    it('detects Runtime.exec in Java', () => {
      const result = scorer.score({
        skillId: 'test',
        content: 'Runtime.getRuntime().exec("ls")',
        language: 'java',
      });
      expect(result.breakdown.dependencySafety).toBe(70);
    });

    it('detects ProcessBuilder in Java', () => {
      const result = scorer.score({
        skillId: 'test',
        content: 'new ProcessBuilder()',
        language: 'java',
      });
      expect(result.breakdown.dependencySafety).toBe(85);
    });
  });

  describe('Ruby detection', () => {
    it('detects system/exec/spawn in Ruby', () => {
      const result = scorer.score({
        skillId: 'test',
        content: 'system("ls")',
        language: 'ruby',
      });
      expect(result.breakdown.dependencySafety).toBe(85);
    });
  });

  describe('scoreSecurity convenience function', () => {
    it('works same as SecurityScorer.score()', () => {
      const result1 = scorer.score({ skillId: 'test', content: 'eval("x")' });
      const result2 = scoreSecurity({ skillId: 'test', content: 'eval("x")' });
      expect(result1.overall).toBe(result2.overall);
      expect(result1.recommendation).toBe(result2.recommendation);
    });
  });

  describe('multiple flags in same category', () => {
    it('accumulates penalties correctly', () => {
      const result = scorer.score({ skillId: 'test', content: 'eval("1")\neval("2")' });
      // Each eval: -30, total -60, score should be 40
      expect(result.breakdown.execSafety).toBe(40);
    });
  });

  describe('edge cases', () => {
    it('handles empty content', () => {
      const result = scorer.score({ skillId: 'test', content: '' });
      expect(result.overall).toBe(100);
      expect(result.recommendation).toBe('approve');
    });

    it('handles multiline content', () => {
      const result = scorer.score({
        skillId: 'test',
        content: `
          const a = 1;
          const b = 2;
          console.log(a + b);
        `,
      });
      expect(result.overall).toBe(100);
    });

    it('includes skillId in result', () => {
      const result = scorer.score({ skillId: 'my-skill-id', content: 'eval("x")' });
      expect(result.skillId).toBe('my-skill-id');
    });

    it('includes scoredAt timestamp', () => {
      const result = scorer.score({ skillId: 'test', content: 'eval("x")' });
      expect(result.scoredAt).toBeDefined();
      expect(new Date(result.scoredAt).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });
});