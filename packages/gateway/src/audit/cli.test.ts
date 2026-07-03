// aether-audit CLI integration test — Council Verdict Phase 3
// =========================================================
// Exercises the audit logger end-to-end through a temp directory:
//   1. Write entries (the trust-trajectory log)
//   2. Verify hash-chain integrity
//   3. Detect tampering
//   4. Export a single-file artifact

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { AuditLogger, type AuditEntry } from './logger.ts';

// Deterministic key so tests are reproducible.
const SIGNING_KEY = 'test-signing-key-that-is-at-least-32-characters-long-abc123';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'aether-audit-cli-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeLogger() {
  return new AuditLogger({ logDir: tmpDir, signingKey: SIGNING_KEY });
}

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    action: 'test.action',
    category: 'agent_execution',
    actor: { type: 'system', id: 'test', label: 'test' },
    outcome: 'success',
    ...over,
  };
}

describe('aether-audit: log + verify chain', () => {
  it('writes entries and verifies a clean chain', () => {
    const log = makeLogger();
    for (let i = 0; i < 5; i++) {
      log.log(entry({ action: `op.${i}`, detail: `step ${i}` }));
    }
    log.forceFlush();

    const result = log.verifyLogIntegrity();
    expect(result.valid).toBe(true);
    expect(result.entriesVerified).toBe(5);
    expect(result.errors).toHaveLength(0);
  });

  it('detects tampering in a previous entry', () => {
    const log = makeLogger();
    for (let i = 0; i < 4; i++) {
      log.log(entry({ action: `op.${i}` }));
    }
    log.forceFlush();

    // Tamper with the raw file: mutate sequence 1's action.
    const logFile = join(log.todayLogPath());
    const lines = readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
    const target = JSON.parse(lines[1]);
    target.action = 'tampered.action';
    lines[1] = JSON.stringify(target);
    // Rewrite the file (overwriting the original HMAC).
    const { writeFileSync } = require('fs');
    writeFileSync(logFile, lines.join('\n') + '\n');

    const result = log.verifyLogIntegrity();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Hash mismatch') || e.includes('tampered'))).toBe(true);
  });

  it('detects a broken sequence (wrong previousHash)', () => {
    const log = makeLogger();
    for (let i = 0; i < 3; i++) log.log(entry({ action: `op.${i}` }));
    log.forceFlush();

    const logFile = log.todayLogPath();
    const lines = readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
    const target = JSON.parse(lines[2]); // third entry
    target.previousHash = 'wronghash';
    lines[2] = JSON.stringify(target);
    const { writeFileSync } = require('fs');
    writeFileSync(logFile, lines.join('\n') + '\n');

    const result = log.verifyLogIntegrity();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Hash chain broken'))).toBe(true);
  });
});

describe('aether-audit: export artifact', () => {
  it('exports a single-file verifiable artifact with all entries', () => {
    const log = makeLogger();
    for (let i = 0; i < 3; i++) {
      log.log(entry({ action: `exported.${i}`, detail: `entry ${i}` }));
    }
    log.forceFlush();

    const artifactPath = join(tmpDir, 'artifact.json');
    const logFiles = log.logFilePaths();
    const allEntries = [];
    for (const file of logFiles) {
      const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) allEntries.push(JSON.parse(line));
    }

    const artifact = {
      format: 'aether-audit-artifact',
      version: 1,
      exportedAt: new Date().toISOString(),
      entryCount: allEntries.length,
      headHash: allEntries[allEntries.length - 1].hash,
      entries: allEntries,
    };
    const { writeFileSync } = require('fs');
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');

    expect(existsSync(artifactPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    expect(parsed.entryCount).toBe(3);
    expect(parsed.entries[2].action).toBe('exported.2');
    expect(parsed.entries[0].hash).toBeTruthy();
    expect(parsed.headHash).toBe(parsed.entries[2].hash);
  });
});

describe('aether-audit: stats + recent', () => {
  it('reports category statistics', () => {
    const log = makeLogger();
    log.log(entry({ category: 'agent_execution', outcome: 'success' }));
    log.log(entry({ category: 'agent_execution', outcome: 'success' }));
    // Use 'partial' (not 'failure') to avoid the auto-flush that 'failure'
    // triggers — statsByCategory reads the in-memory buffer.
    log.log(entry({ category: 'security', outcome: 'partial' }));

    const stats = log.statsByCategory();
    expect(stats['agent_execution']).toBe(2);
    expect(stats['security']).toBe(1);
  });

  it('fetches recent entries within the buffer', () => {
    const log = makeLogger();
    for (let i = 0; i < 10; i++) log.log(entry({ action: `r.${i}` }));
    const recent = log.recent(5);
    expect(recent).toHaveLength(5);
  });
});
