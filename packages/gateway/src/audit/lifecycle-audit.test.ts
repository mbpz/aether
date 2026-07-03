// Lifecycle audit auto-recording tests — B15 (Council Verdict Phase 0-3)
// Proves that ManifestEngine.validate(), LLMProvider.chat(), and the
// gateway wiring produce audit entries WITHOUT manual log() calls.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { AuditLogger } from './logger.js';
import { ManifestEngine } from '../manifest/engine.js';
import { LLMProvider } from '../llm/provider.js';
import { LLMManager } from '../llm/manager.js';

const SIGNING_KEY = 'test-signing-key-that-is-at-least-32-chars-long-xyz';

// --- helpers ---------------------------------------------------------------------------

/** Read all JSONL records from the audit log dir (includes flushed records). */
function readAllRecords(logDir: string): Array<Record<string, unknown>> {
  if (!readdirSync(logDir).some(f => f.endsWith('.jsonl'))) return [];
  const files = readdirSync(logDir).filter(f => f.endsWith('.jsonl')).sort();
  const records: Array<Record<string, unknown>> = [];
  for (const f of files) {
    const lines = readFileSync(join(logDir, f), 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try { records.push(JSON.parse(line)); } catch { /* skip */ }
    }
  }
  return records;
}

let workdir: string;
let audit: AuditLogger;

// Track the original fetch so we can restore after each test.
const originalFetch = globalThis.fetch;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'aether-lifecycle-'));
  audit = new AuditLogger({ logDir: workdir, signingKey: SIGNING_KEY });
});

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error — restore original fetch
  globalThis.fetch = originalFetch;
  rmSync(workdir, { recursive: true, force: true });
});

// --- tests -----------------------------------------------------------------------------

// A permissive manifest used by tests that need an "allowed" outcome.
const PERMISSIVE_MANIFEST = {
  name: 'test-permissive',
  version: '1.0',
  operations: { exec: true, network: true, filesystem: true },
  network: { blockExternal: false, allowedHosts: ['*'] },
};

describe('ManifestEngine auto-audit', () => {
  it('logs manifest_allow on successful validation', () => {
    const engine = new ManifestEngine(audit);
    engine.register({ ...PERMISSIVE_MANIFEST });

    engine.validate({ operation: 'network', target: '127.0.0.1', manifestName: 'test-permissive' });

    // Success path doesn't flush — stays in buffer.
    const records = audit.recent(10);
    const allowEntries = records.filter(r => r.action === 'manifest_allow');
    expect(allowEntries.length).toBeGreaterThanOrEqual(1);
    expect(allowEntries[0].category).toBe('authorization');
    expect(allowEntries[0].outcome).toBe('success');
  });

  it('logs manifest_reject on denied operations', () => {
    const engine = new ManifestEngine(audit);
    const result = engine.validate({ operation: 'exec' });  // default manifest blocks exec

    expect(result.allowed).toBe(false);
    // Failure path flushes immediately — read from disk.
    const records = readAllRecords(workdir);
    const rejectEntries = records.filter(r => r.action === 'manifest_reject');
    expect(rejectEntries.length).toBeGreaterThanOrEqual(1);
    expect(rejectEntries[0].category).toBe('authorization');
    expect(rejectEntries[0].outcome).toBe('failure');
  });

  it('does not throw when no audit logger is wired', () => {
    const engine = new ManifestEngine();  // no audit
    expect(() => engine.validate({ operation: 'exec' })).not.toThrow();
    engine.register({ ...PERMISSIVE_MANIFEST });
    const result = engine.validate({ operation: 'network', target: '127.0.0.1', manifestName: 'test-permissive' });
    expect(result.allowed).toBe(true);
  });
});

describe('LLMProvider auto-audit', () => {
  it('logs llm_call with success outcome for openai-compatible when fetch is stubbed', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-123',
        model: 'test-model',
        choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      text: async () => '',
    };
    // @ts-expect-error — minimal fetch stub for test
    globalThis.fetch = () => Promise.resolve(mockResponse);

    const provider = new LLMProvider(
      { type: 'custom', baseUrl: 'http://localhost:11434', model: 'test-model' },
      audit,
    );

    await provider.chat([{ role: 'user', content: 'hello' }]);

    const records = audit.recent(10);
    const llmEntries = records.filter(r => r.action === 'llm_call');
    expect(llmEntries.length).toBeGreaterThanOrEqual(1);
    expect(llmEntries[0].category).toBe('data_access');
    expect(llmEntries[0].outcome).toBe('success');
    expect(llmEntries[0].metadata['promptTokens']).toBe(10);
  });

  it('logs llm_call with failure outcome when fetch throws', async () => {
    // @ts-expect-error — fetch stub that throws
    globalThis.fetch = () => Promise.reject(new Error('ECONNREFUSED'));

    const provider = new LLMProvider(
      { type: 'custom', baseUrl: 'http://localhost:11434', model: 'test-model' },
      audit,
    );

    await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('ECONNREFUSED');

    // Failure path flushes immediately — read from disk.
    const records = readAllRecords(workdir);
    const failEntries = records.filter(r => r.action === 'llm_call' && r.outcome === 'failure');
    expect(failEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('does not throw when no audit logger is wired', async () => {
    const mockResponse = {
      ok: true, status: 200,
      json: async () => ({
        id: 't', model: 'm', choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      text: async () => '',
    };
    // @ts-expect-error — fetch stub
    globalThis.fetch = () => Promise.resolve(mockResponse);

    const provider = new LLMProvider({ type: 'custom', baseUrl: 'http://localhost:4000', model: 'm' });
    await expect(provider.chat([{ role: 'user', content: 'test' }])).resolves.toBeDefined();
  });
});

describe('LLMManager audit wiring', () => {
  it('passes audit logger to providers created via configure()', async () => {
    const manager = new LLMManager();
    manager.setAuditLogger(audit);

    // @ts-expect-error — fetch stub
    globalThis.fetch = () => Promise.resolve({
      ok: true, status: 200,
      json: async () => ({
        id: 't', model: 'm', choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }),
      text: async () => '',
    });

    manager.configure({ type: 'custom', baseUrl: 'http://localhost:4000', model: 'test-m' });
    await manager.provider!.chat([{ role: 'user', content: 'test' }]);

    const records = audit.recent(10);
    const llmEntries = records.filter(r => r.action === 'llm_call');
    expect(llmEntries.length).toBeGreaterThanOrEqual(1);
  });
});
