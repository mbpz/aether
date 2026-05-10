// EP-04: 分层记忆管理器
// L1 Working Memory  → 内存滑动窗口（最近 N 条）
// L2 Episodic Memory → JSONL 文件持久化（按 session 分片）
// L3 Semantic Memory → Ollama + Qdrant（TF-IDF fallback）

import { randomUUID } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { MemoryEntry, MemoryQuery, MemoryQueryResult, MemoryStats, MemoryTier } from './types.js';
import { TFIDFVectorizer } from './vectorizer.js';
import type { OllamaVectorizer } from './ollama-vectorizer.js';
import type { QdrantStore, SearchResult } from './qdrant-store.js';

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
  // Primary: Ollama + Qdrant
  private embeddingProvider?: OllamaVectorizer;
  private vectorStore?: QdrantStore;
  // Fallback: TF-IDF + in-memory Map
  private fallbackVectorizer: TFIDFVectorizer;
  private fallbackStore: Map<string, SemanticRecord> = new Map();
  private semanticIndexPath: string;
  private semanticDirty = false;   // true = embeddings stale; only applies to fallback mode
  private static readonly SEMANTIC_REFRESH_THRESHOLD = 500;

  /**
   * @param opts.workingWindowSize  L1 滑动窗口大小
   * @param opts.storeDir           L2 JSONL 文件目录
   * @param opts.embeddingProvider  L3 Ollama 向量生成器（可选，未提供则用 TF-IDF）
   * @param opts.vectorStore        L3 Qdrant 持久存储（可选，未提供则用 in-memory Map）
   */
  constructor(opts?: {
    workingWindowSize?: number;
    storeDir?: string;
    embeddingProvider?: OllamaVectorizer;
    vectorStore?: QdrantStore;
  }) {
    this.workingWindowSize = opts?.workingWindowSize ?? DEFAULT_WORKING_WINDOW;
    this.episodicDir = opts?.storeDir ?? DEFAULT_EPISODIC_DIR;
    this.embeddingProvider = opts?.embeddingProvider;
    this.vectorStore = opts?.vectorStore;
    this.fallbackVectorizer = new TFIDFVectorizer();
    this.semanticIndexPath = join(this.episodicDir, SEMANTIC_INDEX_FILE);

    this._ensureDir();
    this._loadSemanticIndex();
    console.log('[aether:memory] ✅ MemoryManager initialized');
    console.log(`[aether:memory]   L1 working-window: ${this.workingWindowSize}`);
    console.log(`[aether:memory]   L2 episodic-dir:   ${this.episodicDir}`);
    const l3Mode = this.embeddingProvider && this.vectorStore ? 'ollama+qdrant' : 'tfidf-fallback';
    console.log(`[aether:memory]   L3 mode: ${l3Mode}`);
  }

  /** 是否使用 Ollama 生成向量（true）还是 TF-IDF fallback（false） */
  private get _useOllama(): boolean { return !!this.embeddingProvider; }
  /** 是否使用 Qdrant 持久化向量存储（true）还是 in-memory fallback（false） */
  private get _useQdrant(): boolean { return !!this.vectorStore; }

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

    // 更新访问计数（仅对 fallback store 有效; Qdrant 由其自身管理）
    for (const entry of results) {
      entry.accessedAt = new Date().toISOString();
      entry.accessCount++;
      if (this.fallbackStore.has(entry.id)) {
        const rec = this.fallbackStore.get(entry.id)!;
        rec.accessedAt = entry.accessedAt;
        rec.accessCount = entry.accessCount;
      }
    }
    if (!this._useQdrant) this._saveSemanticIndex();

    return { entries: results, total: results.length, queryMs: Date.now() - t0 };
  }

  /** 删除指定记忆 */
  forget(id: string): boolean {
    let removed = false;
    const wIdx = this.working.findIndex(e => e.id === id);
    if (wIdx >= 0) { this.working.splice(wIdx, 1); removed = true; }

    if (this._useQdrant && this.vectorStore) {
      await this.vectorStore.delete(id);
      removed = true;
    } else if (this.fallbackStore.has(id)) {
      const rec = this.fallbackStore.get(id)!;
      this.fallbackVectorizer.removeDocument(rec.content);
      this.fallbackStore.delete(id);
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
    const useOllama = !!this.embeddingProvider;
    const useQdrant = !!this.vectorStore;
    const semanticCount = useQdrant
      ? (this.vectorStore ? this.vectorStore.stats().cachedRecords : 0)
      : this.fallbackStore.size;

    const semantic: MemoryStats['semantic'] = {
      count: semanticCount,
      vocabSize: useOllama
        ? (this.embeddingProvider ? this.embeddingProvider.stats().cachedEmbeddings : 0)
        : this.fallbackVectorizer.vocabSize,
      mode: useOllama && useQdrant ? 'ollama+qdrant' : 'tfidf-fallback',
    };

    if (useOllama && this.embeddingProvider) {
      semantic.embeddingProvider = this.embeddingProvider.stats();
    }
    if (useQdrant && this.vectorStore) {
      semantic.vectorStore = this.vectorStore.stats();
    }

    return {
      working:  { count: this.working.length,         tokens: workingTokens },
      episodic: { count: this._episodicLineCount(),  sizeBytes: episodicSize },
      semantic,
      total: this.working.length + semanticCount,
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

  /**
   * 写入单条 L3 语义记忆。
   * - Ollama + Qdrant 可用时：调用 embeddingProvider.vectorize() 生成向量，存入 QdrantStore
   * - Ollama 不可用时：回退到 TF-IDF 向量化（存入 fallbackStore）
   * - Qdrant 不可用时：向量存入 fallbackStore（无论用哪种向量化）
   */
  private async _writeSemantic(entry: MemoryEntry): Promise<void> {
    const useOllama = this._useOllama;
    const useQdrant = this._useQdrant;

    let embedding: number[];

    if (useOllama && this.embeddingProvider) {
      // 优先用 Ollama 生成密集向量
      try {
        embedding = await this.embeddingProvider.vectorize(entry.content);
      } catch (err) {
        console.warn(`[aether:memory] Ollama vectorize failed, falling back to TF-IDF:`, err);
        embedding = this.fallbackVectorizer.vectorize(entry.content);
      }
    } else {
      // TF-IDF 回退（同时更新 fallbackVectorizer IDF 词表）
      this.fallbackVectorizer.addDocument(entry.content);
      embedding = this.fallbackVectorizer.vectorize(entry.content);
    }

    const rec: SemanticRecord = {
      id: entry.id,
      content: entry.content,
      embedding,
      metadata: entry.metadata,
      createdAt: entry.createdAt,
      accessedAt: entry.accessedAt,
      accessCount: entry.accessCount,
    };

    if (useQdrant && this.vectorStore) {
      // 直接写入 Qdrant（由 QdrantStore 自己管理持久化）
      try {
        await this.vectorStore.upsert({
          id: rec.id,
          vector: rec.embedding,
          payload: {
            content: rec.content,
            metadata: rec.metadata,
            createdAt: rec.createdAt,
            accessedAt: rec.accessedAt,
            accessCount: rec.accessCount,
          },
        });
      } catch (err) {
        console.warn(`[aether:memory] Qdrant upsert failed, storing in fallback map:`, err);
        this._fallbackUpsert(rec);
      }
    } else {
      this._fallbackUpsert(rec);
    }
  }

  /** 写入 fallback in-memory store（附带 dirty-flag 逻辑） */
  private _fallbackUpsert(rec: SemanticRecord): void {
    if (this.fallbackStore.size >= MemoryManager.SEMANTIC_REFRESH_THRESHOLD) {
      this.semanticDirty = true;
    } else if (this.fallbackStore.size > 0) {
      // 小 store：重新计算所有 embedding 以保证 IDF 准确
      this._refreshAllEmbeddingsFallback();
    }
    this.fallbackStore.set(rec.id, rec);
    // fallback 模式下每次写入都保持 index 同步（Qdrant 模式不需要）
    this._saveSemanticIndex();
  }

  private _refreshAllEmbeddingsFallback(): void {
    for (const rec of this.fallbackStore.values()) {
      rec.embedding = this.fallbackVectorizer.vectorize(rec.content);
    }
    this.semanticDirty = false;
  }

  /**
   * 语义检索 L3。
   * - Qdrant 可用时：Query 向量化后调用 QdrantStore.search()，返回 top-K
   * - Qdrant 不可用时：对 fallbackStore 做 TF-IDF 余弦检索
   */
  private async _searchSemantic(query: MemoryQuery): Promise<Array<MemoryEntry & { score?: number }>> {
    // 无文本查询：按 importance 排序返回（两种模式通用）
    if (!query.text) {
      if (this._useQdrant && this.vectorStore) {
        // Qdrant 模式：需要查询才能知道记录；这里走 fallback 逻辑获取全量
        // （Qdrant 的无向量查询能力有限，先用 fallback store）
        return this._fallbackSearchNoText(query);
      }
      return this._fallbackSearchNoText(query);
    }

    // ── Qdrant 检索路径 ────────────────────────────────────────────────────
    if (this._useQdrant && this.vectorStore) {
      const queryVec = await this._vectorizeQuery(query.text);
      if (!queryVec || queryVec.length === 0) return [];

      try {
        const qdrantResults = await this.vectorStore.search(queryVec, {
          limit: query.limit ?? 20,
          filter: this._buildQdrantFilter(query),
        });

        return qdrantResults
          .filter(r => r.score > 0.01)
          .map(r => this._searchResultToEntry(r, r.score));
      } catch (err) {
        console.warn(`[aether:memory] Qdrant search failed, falling back to TF-IDF:`, err);
        // 降级到 TF-IDF
        return this._fallbackSearch(query, queryVec);
      }
    }

    // ── TF-IDF fallback 检索路径 ───────────────────────────────────────────
    const queryVec = this.fallbackVectorizer.vectorize(query.text);
    return this._fallbackSearch(query, queryVec);
  }

  private _fallbackSearchNoText(query: MemoryQuery): Array<MemoryEntry & { score?: number }> {
    return Array.from(this.fallbackStore.values())
      .filter(r => {
        if (query.source && r.metadata.source !== query.source) return false;
        if (query.sessionId && r.metadata.sessionId !== query.sessionId) return false;
        return true;
      })
      .map(r => this._recToEntry(r, r.metadata.importance ?? 0.5));
  }

  private _fallbackSearch(query: MemoryQuery, queryVec: number[]): Array<MemoryEntry & { score?: number }> {
    if (this.semanticDirty) {
      this._refreshAllEmbeddingsFallback();
      this._saveSemanticIndex();
    }

    const scored: Array<{ rec: SemanticRecord; score: number }> = [];
    for (const rec of this.fallbackStore.values()) {
      if (query.source    && rec.metadata.source    !== query.source)    continue;
      if (query.sessionId && rec.metadata.sessionId !== query.sessionId) continue;
      if (query.tags?.length && !query.tags.some(t => rec.metadata.tags?.includes(t))) continue;
      if (query.minImportance !== undefined && (rec.metadata.importance ?? 0) < query.minImportance) continue;

      const score = this.fallbackVectorizer.cosineSim(queryVec, rec.embedding);
      if (score > 0.01) scored.push({ rec, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, query.limit ?? 10).map(({ rec, score }) => this._recToEntry(rec, score));
  }

  /** 将 Qdrant SearchResult 转换为 MemoryEntry */
  private _searchResultToEntry(r: SearchResult, score: number): MemoryEntry & { score: number } {
    const payload = r.payload ?? {};
    return {
      id: r.id,
      tier: 'semantic',
      content: typeof payload.content === 'string' ? payload.content : '',
      metadata: (payload.metadata as MemoryEntry['metadata']) ?? {},
      embedding: undefined, // Qdrant 返回的向量不再带回来
      createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
      accessedAt: typeof payload.accessedAt === 'string' ? payload.accessedAt : new Date().toISOString(),
      accessCount: typeof payload.accessCount === 'number' ? payload.accessCount : 0,
      score,
    };
  }

  /** 将文本向量化（优先 Ollama，回退 TF-IDF） */
  private async _vectorizeQuery(text: string): Promise<number[]> {
    if (this._useOllama && this.embeddingProvider) {
      try {
        return await this.embeddingProvider.vectorize(text);
      } catch (err) {
        console.warn(`[aether:memory] Ollama query vectorize failed, using TF-IDF:`, err);
      }
    }
    return this.fallbackVectorizer.vectorize(text);
  }

  /** 构建 Qdrant 过滤条件 */
  private _buildQdrantFilter(query: MemoryQuery): Record<string, unknown> | undefined {
    const conditions: unknown[] = [];
    if (query.source)    conditions.push({ key: 'metadata.source',     match: { value: query.source } });
    if (query.sessionId) conditions.push({ key: 'metadata.sessionId', match: { value: query.sessionId } });
    if (query.tags?.length) {
      for (const tag of query.tags) {
        conditions.push({ key: 'metadata.tags', match: { any: [tag] } });
      }
    }
    if (conditions.length === 0) return undefined;
    return { must: conditions };
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

  // ── 持久化（仅 fallback TF-IDF 模式使用; Qdrant 模式由 QdrantStore 自管理） ──

  private _ensureDir(): void {
    if (!existsSync(this.episodicDir)) {
      mkdirSync(this.episodicDir, { recursive: true });
    }
  }

  private _saveSemanticIndex(): void {
    // Qdrant 模式下索引由 Qdrant 自管理，不需要写本地文件
    if (this._useQdrant) return;
    try {
      const data = {
        vectorizer: this.fallbackVectorizer.serialize(),
        store: Object.fromEntries(this.fallbackStore),
        savedAt: new Date().toISOString(),
      };
      writeFileSync(this.semanticIndexPath, JSON.stringify(data), 'utf-8');
    } catch (err) {
      console.warn('[aether:memory] Failed to save semantic index:', err);
    }
  }

  private _loadSemanticIndex(): void {
    // Qdrant 模式下不需要加载本地索引（由 Qdrant 提供）
    if (this._useQdrant) return;
    if (!existsSync(this.semanticIndexPath)) return;
    try {
      const raw = readFileSync(this.semanticIndexPath, 'utf-8');
      const data = JSON.parse(raw);
      this.fallbackVectorizer = TFIDFVectorizer.deserialize(data.vectorizer);
      this.fallbackStore = new Map(Object.entries(data.store));
      console.log(`[aether:memory] Loaded semantic index: ${this.fallbackStore.size} docs`);
    } catch (err) {
      console.warn('[aether:memory] Failed to load semantic index:', err);
    }
  }
}
