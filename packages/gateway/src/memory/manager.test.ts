// MemoryManager contract tests — B8.1 retro-fit.
// 覆盖 remember / recall / forget / stats / compaction 的纯路径，
// 用 tmpdir 隔离磁盘状态。不测 Ollama/Qdrant（需要 mock HTTP）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryManager } from './manager.js';

describe('MemoryManager', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'aether-mem-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  describe('construction', () => {
    it('initializes with default config', () => {
      const m = new MemoryManager({ storeDir: workdir });
      const s = m.stats();
      expect(s.total).toBe(0);
      expect(s.semantic.mode).toBe('tfidf-fallback');
    });
  });

  describe('remember()', () => {
    it('returns a MemoryEntry with id + timestamps', () => {
      const m = new MemoryManager({ storeDir: workdir });
      const e = m.remember('hello world', { source: 'test' });
      expect(e.id).toBeDefined();
      expect(e.content).toBe('hello world');
      expect(e.metadata.source).toBe('test');
      expect(e.metadata.importance).toBe(0.5); // default
      expect(e.createdAt).toBeDefined();
      expect(e.accessCount).toBe(0);
    });

    it('writes to working / episodic / semantic by default', () => {
      const m = new MemoryManager({ storeDir: workdir });
      m.remember('x');
      const s = m.stats();
      expect(s.working.count).toBeGreaterThanOrEqual(1);
      // Semantic count comes from the fallbackStore (in-memory Map for TF-IDF).
      expect(s.semantic.count).toBeGreaterThanOrEqual(1);
    });

    it('respects tier filter', () => {
      const m = new MemoryManager({ storeDir: workdir });
      m.remember('only-working', {}, ['working']);
      const s = m.stats();
      expect(s.working.count).toBe(1);
      // Episodic write skipped; semantic write skipped.
      expect(s.semantic.count).toBe(0);
    });
  });

  describe('recall()', () => {
    it('returns matching entries from working memory', async () => {
      const m = new MemoryManager({ storeDir: workdir });
      m.remember('the quick brown fox', { tags: ['animal'] }, ['working']);
      m.remember('lazy dog', { tags: ['animal'] }, ['working']);

      const r = await m.recall({ tier: 'working', text: 'fox' });
      expect(r.entries.length).toBeGreaterThanOrEqual(1);
      expect(r.queryMs).toBeGreaterThanOrEqual(0);
    });

    it('respects limit', async () => {
      const m = new MemoryManager({ storeDir: workdir });
      for (let i = 0; i < 10; i++) m.remember(`entry-${i}`, {}, ['working']);
      const r = await m.recall({ tier: 'working', limit: 3 });
      expect(r.entries.length).toBeLessThanOrEqual(3);
    });

    it('deduplicates entries appearing in multiple tiers', async () => {
      const m = new MemoryManager({ storeDir: workdir });
      m.remember('shared-content', {}, ['working', 'semantic']);
      const r = await m.recall({ text: 'shared' });
      const ids = r.entries.map((e) => e.id);
      const unique = new Set(ids);
      expect(ids.length).toBe(unique.size);
    });
  });

  describe('forget()', () => {
    it('removes a working-only entry by id', async () => {
      const m = new MemoryManager({ storeDir: workdir });
      const e = m.remember('to-be-forgotten', {}, ['working']);
      expect(m.stats().working.count).toBe(1);
      const ok = await m.forget(e.id);
      expect(ok).toBe(true);
      expect(m.stats().working.count).toBe(0);
    });

    it('returns false for unknown id', async () => {
      const m = new MemoryManager({ storeDir: workdir });
      const ok = await m.forget('does-not-exist');
      expect(ok).toBe(false);
    });
  });

  describe('clearWorking()', () => {
    it('empties only the L1 working tier', () => {
      const m = new MemoryManager({ storeDir: workdir });
      m.remember('a', {}, ['working', 'episodic']);
      m.remember('b', {}, ['working', 'episodic']);
      expect(m.stats().working.count).toBe(2);
      m.clearWorking();
      expect(m.stats().working.count).toBe(0);
    });
  });

  describe('working-window enforcement', () => {
    it('drops oldest entries when window size is exceeded', () => {
      const m = new MemoryManager({ storeDir: workdir, workingWindowSize: 3 });
      for (let i = 0; i < 5; i++) m.remember(`e${i}`, {}, ['working']);
      const s = m.stats();
      expect(s.working.count).toBeLessThanOrEqual(3);
    });
  });

  describe('stats()', () => {
    it('reports tfidf-fallback when no Ollama/Qdrant configured', () => {
      const m = new MemoryManager({ storeDir: workdir });
      const s = m.stats();
      expect(s.semantic.mode).toBe('tfidf-fallback');
      expect(s.semantic.embeddingProvider).toBeUndefined();
      expect(s.semantic.vectorStore).toBeUndefined();
    });

    it('total = working + episodic + semantic counts', () => {
      const m = new MemoryManager({ storeDir: workdir });
      m.remember('a', {}, ['working']);
      m.remember('b', {}, ['working', 'semantic']);
      const s = m.stats();
      expect(s.total).toBe(s.working.count + s.episodic.count + s.semantic.count);
    });
  });

  describe('compaction', () => {
    it('getCompactionState returns initial state', () => {
      const m = new MemoryManager({ storeDir: workdir });
      const state = m.getCompactionState();
      expect(state.totalCompactions).toBe(0);
      expect(state.totalEventsCompacted).toBe(0);
      expect(state.lastCompactionTimestamp).toBeNull();
    });

    it('enableCompaction + disableCompaction are idempotent', () => {
      const m = new MemoryManager({ storeDir: workdir });
      m.enableCompaction({ enabled: true, intervalMs: 60_000 });
      m.disableCompaction();
      m.disableCompaction(); // second call should not throw
      const state = m.getCompactionState();
      expect(state.totalCompactions).toBe(0);
    });

    it('compactL2toL3 skips when too few events', async () => {
      const m = new MemoryManager({ storeDir: workdir });
      m.enableCompaction({ minEventsToCompact: 100 });
      const r = await m.compactL2toL3();
      expect(r.skipped).toBe(true);
      expect(r.compacted).toBe(0);
    });
  });
});
