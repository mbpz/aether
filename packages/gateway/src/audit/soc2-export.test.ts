// SOC2 export format tests — Council Verdict Phase 3 (Surpass Plan)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildSOC2Export, SOC2ControlMapping } from './soc2-export.js';

let workdir: string;
const SIGNING_KEY = 'test-key-for-soc2-export-that-is-at-least-32-chars';

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'aether-soc2-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/** Write a valid chained JSONL file with the given records. */
function writeChainedLog(filename: string, records: Array<{ action: string; category: string; outcome: 'success' | 'failure' }>) {
  // Compute a valid chain. We use a simplified hash (not the real HMAC)
  // because we don't have the signing key in this unit test — the SOC2
  // export builder only checks previousHash continuity and re-verifies
  // using its own logic, not HMAC re-computation.
  let prev = 'GENESIS';
  const lines = records.map((r, i) => {
    const rec = {
      id: `id-${i}`,
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
      sequence: i,
      previousHash: prev,
      action: r.action,
      category: r.category,
      actor: { type: 'system', id: 'test' },
      outcome: r.outcome,
      hash: `hash-${i}-${prev}`,   // deterministic fake hash
      system: 'aether-gateway',
      version: 1,
    };
    prev = rec.hash;
    return JSON.stringify(rec);
  });
  writeFileSync(join(workdir, filename), lines.join('\n') + '\n');
}

describe('buildSOC2Export', () => {
  it('produces a valid SOC2 export with correct format metadata', () => {
    writeChainedLog('2026-07-01.jsonl', [
      { action: 'manifest_allow', category: 'authorization', outcome: 'success' },
      { action: 'llm_call', category: 'data_access', outcome: 'success' },
    ]);

    const report = buildSOC2Export({ logDir: workdir, signingKey: SIGNING_KEY });

    expect(report.format).toBe('aether-soc2-export');
    expect(report.version).toBe(1);
    expect(report.entries.length).toBe(2);
    expect(report.integrity.valid).toBe(true);
    expect(report.integrity.entriesVerified).toBe(2);
  });

  it('maps audit categories to SOC2 controls and computes coverage', () => {
    writeChainedLog('2026-07-01.jsonl', [
      { action: 'manifest_allow', category: 'authorization', outcome: 'success' },
      { action: 'manifest_reject', category: 'authorization', outcome: 'failure' },
      { action: 'llm_call', category: 'data_access', outcome: 'success' },
      { action: 'sandbox_exec_done', category: 'agent_execution', outcome: 'success' },
      { action: 'config_change', category: 'configuration', outcome: 'success' },
    ]);

    const report = buildSOC2Export({ logDir: workDir(), signingKey: SIGNING_KEY });

    // CC6 (logical access) should be covered by authorization events.
    const cc6 = report.controlCoverage.controls.find(c => c.controlId === 'CC6');
    expect(cc6).toBeDefined();
    expect(cc6!.evidenceFound.length).toBeGreaterThanOrEqual(1);
    // Has both success and failure → partial.
    expect(cc6!.status).toBe('partial');

    // CC7 (system operations) has no evidence in our test data → gap.
    const cc7 = report.controlCoverage.controls.find(c => c.controlId === 'CC7');
    expect(cc7!.status).toBe('gap');

    // Coverage counts should be coherent.
    expect(report.controlCoverage.covered + report.controlCoverage.partial + report.controlCoverage.gap).toBe(report.controlCoverage.total);
  });

  it('detects chain break in integrity check', () => {
    // Write a broken-chain file.
    const records = [
      { id: 'a1', timestamp: '2026-07-01T00:00:00Z', sequence: 0, previousHash: 'GENESIS',
        action: 'test', category: 'system', actor: { type: 'system', id: 't' },
        outcome: 'success', hash: 'h0', system: 'aether-gateway', version: 1 },
      { id: 'a2', timestamp: '2026-07-01T00:00:01Z', sequence: 1, previousHash: 'WRONG',
        action: 'test', category: 'system', actor: { type: 'system', id: 't' },
        outcome: 'success', hash: 'h1', system: 'aether-gateway', version: 1 },
    ];
    writeFileSync(join(workdir, '2026-07-01.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const report = buildSOC2Export({ logDir: workdir, signingKey: SIGNING_KEY });
    expect(report.integrity.valid).toBe(false);
    expect(report.integrity.entriesVerified).toBe(1);
  });

  it('supports time-range filtering via since/until', () => {
    writeChainedLog('2026-07-01.jsonl', [
      { action: 'old_event', category: 'system', outcome: 'success' },
      { action: 'auth_event', category: 'authorization', outcome: 'success' },
      { action: 'new_event', category: 'data_access', outcome: 'success' },
    ]);

    // Filter to middle record only (by timestamp).
    const all = buildSOC2Export({ logDir: workdir, signingKey: SIGNING_KEY });
    const middleTs = all.entries[1].timestamp;

    const filtered = buildSOC2Export({ logDir: workdir, signingKey: SIGNING_KEY, since: middleTs, until: middleTs });
    expect(filtered.entries.length).toBe(1);
    expect(filtered.entries[0].action).toBe('auth_event');
  });

  it('handles empty log directory gracefully', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'aether-empty-'));
    try {
      const report = buildSOC2Export({ logDir: emptyDir, signingKey: SIGNING_KEY });
      expect(report.integrity.valid).toBe(true);
      expect(report.integrity.entriesVerified).toBe(0);
      expect(report.entries.length).toBe(0);
      expect(report.controlCoverage.gap).toBe(report.controlCoverage.total);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

function workDir() { return workdir; }
