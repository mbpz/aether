// EP-04: 分层记忆管理器
// L1 Working Memory  → 内存滑动窗口（最近 N 条）
// L2 Episodic Memory → JSONL 文件持久化（按 session 分片）
// L3 Semantic Memory → TF-IDF + 余弦相似度检索

import { randomUUID } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { MemoryEntry, MemoryQuery, MemoryQueryResult, MemoryStats, MemoryTier } from './types.js';
import { TFIDFVectorizer } from './vectorizer.js';

const DEFAULT_WORKING_WINDOW = 50;   // L1：保留最近 50 条
const DEFAULT_EPISODIC_DIR   = process.env.MEMORY_DIR ?? './memory-store';
const SEMANTIC_INDEX_FILE    = 'semantic-index.json';

interface SemanticRecord {
  id: string;
  content: string;
  embedding: number[];
  metadata: MemoryEntry['metadata'];
  createdAt: string;
  accessedAt: string;
  accessCount: number;
}

export class MemoryManager {
  // ── L1 Working Memory ─────────────────────────────────────────────────────
  private working: MemoryEntry[] = [];
  private workingWindowSize: number;

  // ── L2 Episodic Memory ────────────────────────────────────────────────────
  private episodicDir: string;

  // ── L3 Semantic Memory ────────────────────────────────────────────────────
  private vectorizer: TFIDFVectorizer;
  private semanticStore: Map<string, SemanticRecord> = new Map();
  private semanticIndexPath: string;
  private semanticDirty = false;   // true = embeddings stale, needs full refresh
  private static readonly SEMANTIC_REFRESH_THRESHOLD = 500;

  constructor(opts?: { workingWindowSize?: number; storeDir?: string }) {
    this.workingWindowSize = opts?.workingWindowSize ?? DEFAULT_WORKING_WINDOW;
    this.episodicDir = opts?.storeDir ?? DEFAULT_EPISODIC_DIR;
    this.vectorizer = new TFIDFVectorizer();
    this.semanticIndexPath = join(this.episodicDir, SEMANTIC_INDEX_FILE);

    this._ensureDir();
    this._loadSemanticIndex();
    console.log('[aether:memory] ✅ MemoryManager initialized');
    console.log(`[aether:memory]   L1 working-window: ${this.workingWindowSize}`);
    console.log(`[aether:memory]   L2 episodic-dir:   ${this.episodicDir}`);
    console.log(`[aether:memory]   L3 semantic-vocab: ${this.vectorizer.vocabSize} terms, ${this.semanticStore.size} docs`);
  }

  // ── 写入记忆 ──────────────────────────────────────────────────────────────

  /**
   * 写入记忆
   * @param tier  目标层级（不填则全部写入）
   */
  remember(
    content: string,
    metadata: MemoryEntry['metadata'] = {},
    tiers: MemoryTier[] = ['working', 'episodic', 'semantic']
  ): MemoryEntry {
    const id = randomUUID();
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      id,
      tier: tiers[0],
      content,
      metadata: { importance: 0.5, ...metadata },
      createdAt: now,
      accessedAt: now,
      accessCount: 0,
    };

    if (tiers.includes('working'))  this._writeWorking(entry);
    if (tiers.includes('episodic')) this._writeEpisodic(entry);
    if (tiers.includes('semantic')) this._writeSemantic(entry);

    return entry;
  }

  // ── 检索记忆 ──────────────────────────────────────────────────────────────

  recall(query: MemoryQuery): MemoryQueryResult {
    const t0 = Date.now();
    const limit = query.limit ?? 10;
    let results: Array<MemoryEntry & { score?: number }> = [];

    if (!query.tier || query.tier === 'working') {
      results.push(...this._searchWorking(query));
    }
    if (!query.tier || query.tier === 'semantic') {
      results.push(...this._searchSemantic(query));
    }
    if (!query.tier || query.tier === 'episodic') {
      results.push(...this._searchEpisodic(query));
    }

    // 去重（同一 id 可能在多层都有）
    const seen = new Set<string>();
    results = results.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });

    // 按 score（有则用 score，无则用 importance）排序
    results.sort((a, b) => {
      const sa = a.score ?? a.metadata.importance ?? 0;
      const sb = b.score ?? b.metadata.importance ?? 0;
      return sb - sa;
    });

    results = results.slice(0, limit);

    // 更新访问计数
    for (const entry of results) {
      entry.accessedAt = new Date().toISOString();
      entry.accessCount++;
      if (this.semanticStore.has(entry.id)) {
        const rec = this.semanticStore.get(entry.id)!;
        rec.accessedAt = entry.accessedAt;
        rec.accessCount = entry.accessCount;
      }
    }
    this._saveSemanticIndex();

    return { entries: results, total: results.length, queryMs: Date.now() - t0 };
  }

  /** 删除指定记忆 */
  forget(id: string): boolean {
    let removed = false;
    const wIdx = this.working.findIndex(e => e.id === id);
    if (wIdx >= 0) { this.working.splice(wIdx, 1); removed = true; }

    if (this.semanticStore.has(id)) {
      const rec = this.semanticStore.get(id)!;
      this.vectorizer.removeDocument(rec.content);
      this.semanticStore.delete(id);
      this._saveSemanticIndex();
      removed = true;
    }
    return removed;
  }

  /** 清空 L1 工作记忆 */
  clearWorking(): void {
    this.working = [];
  }

  /** 统计信息 */
  stats(): MemoryStats {
    const workingTokens = this.working.reduce((s, e) => s + e.content.split(/\s+/).length, 0);
    const episodicSize = this._episodicFileSize();
    return {
      working:  { count: this.working.length,         tokens: workingTokens },
      episodic: { count: this._episodicLineCount(),   sizeBytes: episodicSize },
      semantic: { count: this.semanticStore.size,      vocabSize: this.vectorizer.vocabSize },
      total: this.working.length + this.semanticStore.size,
    };
  }

  // ── L1 Working Memory 内部实现 ────────────────────────────────────────────

  private _writeWorking(entry: MemoryEntry): void {
    this.working.push({ ...entry, tier: 'working' });
    // 超出窗口时遗忘最旧的（低重要度优先）
    if (this.working.length > this.workingWindowSize) {
      this.working.sort((a, b) =>
        (a.metadata.importance ?? 0.5) - (b.metadata.importance ?? 0.5)
      );
      this.working.splice(0, this.working.length - this.workingWindowSize);
    }
  }

  private _searchWorking(query: MemoryQuery): Array<MemoryEntry & { score?: number }> {
    let entries = [...this.working];
    if (query.source)    entries = entries.filter(e => e.metadata.source === query.source);
    if (query.sessionId) entries = entries.filter(e => e.metadata.sessionId === query.sessionId);
    if (query.tags?.length) {
      entries = entries.filter(e => query.tags!.some(t => e.metadata.tags?.includes(t)));
    }
    if (query.minImportance !== undefined) {
      entries = entries.filter(e => (e.metadata.importance ?? 0) >= query.minImportance!);
    }
    // 文本过滤（简单子串匹配，L1 不做向量化）
    if (query.text) {
      const lq = query.text.toLowerCase();
      entries = entries.filter(e => e.content.toLowerCase().includes(lq));
    }
    return entries.map(e => ({ ...e, score: e.metadata.importance ?? 0.5 }));
  }

  // ── L2 Episodic Memory 内部实现 ───────────────────────────────────────────

  private _episodicPath(sessionId?: string): string {
    const name = sessionId ? `session-${sessionId}.jsonl` : 'episodic.jsonl';
    return join(this.episodicDir, name);
  }

  private _writeEpisodic(entry: MemoryEntry): void {
    const path = this._episodicPath(entry.metadata.sessionId);
    appendFileSync(path, JSON.stringify({ ...entry, tier: 'episodic' }) + '\n', 'utf-8');
  }

  private _searchEpisodic(query: MemoryQuery): Array<MemoryEntry & { score?: number }> {
    const results: Array<MemoryEntry & { score?: number }> = [];
    // 简化：只搜主文件 + session 文件
    const files: string[] = [join(this.episodicDir, 'episodic.jsonl')];
    if (query.sessionId) files.push(this._episodicPath(query.sessionId));

    for (const path of files) {
      if (!existsSync(path)) continue;
      const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry: MemoryEntry = JSON.parse(line);
          if (query.source    && entry.metadata.source    !== query.source)    continue;
          if (query.sessionId && entry.metadata.sessionId !== query.sessionId) continue;
          if (query.tags?.length && !query.tags.some(t => entry.metadata.tags?.includes(t))) continue;
          if (query.text) {
            const lq = query.text.toLowerCase();
            if (!entry.content.toLowerCase().includes(lq)) continue;
          }
          results.push({ ...entry, score: entry.metadata.importance ?? 0.3 });
        } catch { /* skip malformed lines */ }
      }
    }
    return results;
  }

  private _episodicLineCount(): number {
    const path = join(this.episodicDir, 'episodic.jsonl');
    if (!existsSync(path)) return 0;
    return readFileSync(path, 'utf-8').split('\n').filter(Boolean).length;
  }

  private _episodicFileSize(): number {
    const path = join(this.episodicDir, 'episodic.jsonl');
    if (!existsSync(path)) return 0;
    try {
      const { statSync } = require('fs');
      return statSync(path).size;
    } catch { return 0; }
  }

  // ── L3 Semantic Memory 内部实现 ───────────────────────────────────────────

  private _writeSemantic(entry: MemoryEntry): void {
    // Threshold-based refresh: if store is large, defer full refresh to query time.
    // This trades a small accuracy loss for O(N) -> O(1) per insert.
    if (this.semanticStore.size >= MemoryManager.SEMANTIC_REFRESH_THRESHOLD) {
      this.semanticDirty = true;
    } else if (this.semanticStore.size > 0) {
      // Small store: refresh all embeddings so IDF is accurate for existing docs
      this._refreshAllEmbeddings();
    }

    this.vectorizer.addDocument(entry.content);
    const embedding = this.vectorizer.vectorize(entry.content);
    const rec: SemanticRecord = {
      id: entry.id,
      content: entry.content,
      embedding,
      metadata: entry.metadata,
      createdAt: entry.createdAt,
      accessedAt: entry.accessedAt,
      accessCount: entry.accessCount,
    };
    this.semanticStore.set(entry.id, rec);
    this._saveSemanticIndex();
  }

  private _refreshAllEmbeddings(): void {
    for (const rec of this.semanticStore.values()) {
      rec.embedding = this.vectorizer.vectorize(rec.content);
    }
    this.semanticDirty = false;
  }

  private _searchSemantic(query: MemoryQuery): Array<MemoryEntry & { score?: number }> {
    // If dirty (embeddings stale due to deferred refresh), refresh now
    if (this.semanticDirty) {
      this._refreshAllEmbeddings();
      this._saveSemanticIndex();
    }
    if (!query.text || this.semanticStore.size === 0) {
      // 无文本查询：按 importance 排序返回
      return Array.from(this.semanticStore.values())
        .filter(r => {
          if (query.source && r.metadata.source !== query.source) return false;
          if (query.sessionId && r.metadata.sessionId !== query.sessionId) return false;
          return true;
        })
        .map(r => this._recToEntry(r, r.metadata.importance ?? 0.5));
    }

    const queryVec = this.vectorizer.vectorize(query.text);
    const scored: Array<{ rec: SemanticRecord; score: number }> = [];

    for (const rec of this.semanticStore.values()) {
      if (query.source    && rec.metadata.source    !== query.source)    continue;
      if (query.sessionId && rec.metadata.sessionId !== query.sessionId) continue;
      if (query.tags?.length && !query.tags.some(t => rec.metadata.tags?.includes(t))) continue;
      if (query.minImportance !== undefined && (rec.metadata.importance ?? 0) < query.minImportance) continue;

      const score = this.vectorizer.cosineSim(queryVec, rec.embedding);
      if (score > 0.01) scored.push({ rec, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map(({ rec, score }) => this._recToEntry(rec, score));
  }

  private _recToEntry(rec: SemanticRecord, score: number): MemoryEntry & { score: number } {
    return {
      id: rec.id,
      tier: 'semantic',
      content: rec.content,
      metadata: rec.metadata,
      embedding: rec.embedding,
      createdAt: rec.createdAt,
      accessedAt: rec.accessedAt,
      accessCount: rec.accessCount,
      score,
    };
  }

  // ── 持久化 ────────────────────────────────────────────────────────────────

  private _ensureDir(): void {
    if (!existsSync(this.episodicDir)) {
      mkdirSync(this.episodicDir, { recursive: true });
    }
  }

  private _saveSemanticIndex(): void {
    try {
      const data = {
        vectorizer: this.vectorizer.serialize(),
        store: Object.fromEntries(this.semanticStore),
        savedAt: new Date().toISOString(),
      };
      writeFileSync(this.semanticIndexPath, JSON.stringify(data), 'utf-8');
    } catch (err) {
      console.warn('[aether:memory] Failed to save semantic index:', err);
    }
  }

  private _loadSemanticIndex(): void {
    if (!existsSync(this.semanticIndexPath)) return;
    try {
      const raw = readFileSync(this.semanticIndexPath, 'utf-8');
      const data = JSON.parse(raw);
      this.vectorizer = TFIDFVectorizer.deserialize(data.vectorizer);
      this.semanticStore = new Map(Object.entries(data.store));
      console.log(`[aether:memory] Loaded semantic index: ${this.semanticStore.size} docs`);
    } catch (err) {
      console.warn('[aether:memory] Failed to load semantic index:', err);
    }
  }
}
