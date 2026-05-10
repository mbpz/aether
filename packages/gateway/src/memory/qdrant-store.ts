// EP-04: Qdrant Vector DB Integration
// 使用 Qdrant 本地向量数据库作为 L3 Semantic Memory 的持久化后端
// 替代内存 Map，支持百万级向量检索，延迟 < 200ms

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ── 类型定义 ─────────────────────────────────────────────────────────────

export interface QdrantConfig {
  url?: string;          // Qdrant 服务器地址，默认 http://localhost:6333
  collection?: string;    // Collection 名称，默认 aether-memory
  vectorSize?: number;    // 向量维度（需与嵌入模型匹配）
  limit?: number;        // 每次检索返回的最大结果数
  timeoutMs?: number;
  persistencePath?: string; // 持久化目录（用于离线模式）
}

export interface SearchResult {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface QdrantRecord {
  id: string;
  vector: number[];
  payload: {
    content: string;
    metadata: Record<string, unknown>;
    createdAt: string;
    accessedAt: string;
    accessCount: number;
  };
}

// ── Qdrant Client Wrapper ──────────────────────────────────────────────────

export class QdrantStore {
  private config: Required<QdrantConfig>;
  private qdrant: any = null;
  private initialized = false;
  private localCache: Map<string, QdrantRecord> = new Map();
  private pendingUpserts: QdrantRecord[] = [];
  private flushIntervalMs = 2000;

  constructor(config: QdrantConfig = {}) {
    this.config = {
      url: config.url ?? 'http://localhost:6333',
      collection: config.collection ?? 'aether-memory',
      vectorSize: config.vectorSize ?? 768,
      limit: config.limit ?? 20,
      timeoutMs: config.timeoutMs ?? 5000,
      persistencePath: config.persistencePath ?? './memory-store/qdrant',
    };

    setInterval(() => this._flush(), this.flushIntervalMs);
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // 尝试加载 @qdrant/qdrant-js-client-rest
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { QdrantClient } = require('@qdrant/qdrant-js-client-rest');
      this.qdrant = new QdrantClient({ url: this.config.url });
      console.log(`[aether:qdrant] ✅ Qdrant client connected: ${this.config.url}`);

      // 确保 Collection 存在
      await this._ensureCollection();
      this.initialized = true;
    } catch {
      console.warn(`[aether:qdrant] ⚠️  Qdrant not available — using local-cache fallback`);
      this._loadLocalCache();
    }
  }

  /**
   * 添加或更新向量记录
   */
  async upsert(record: QdrantRecord): Promise<void> {
    if (!this.initialized) return;

    if (this.qdrant) {
      try {
        await this.qdrant.upsert(this.config.collection, {
          points: [{
            id: record.id,
            vector: record.vector,
            payload: record.payload,
          }],
        });
      } catch {
        // Qdrant 不可用时缓存到本地
        this.localCache.set(record.id, record);
      }
    } else {
      this.localCache.set(record.id, record);
    }
  }

  /**
   * 相似度检索
   */
  async search(vector: number[], opts?: { limit?: number; filter?: Record<string, unknown> }): Promise<SearchResult[]> {
    if (!this.initialized) return [];

    const limit = opts?.limit ?? this.config.limit;

    if (this.qdrant) {
      try {
        const results = await this.qdrant.search(this.config.collection, {
          vector,
          limit,
          score_threshold: 0.01,
          with_payload: true,
          ...(opts?.filter ? { filter: opts.filter } : {}),
        });

        return results.map((r: any) => ({
          id: r.id,
          score: r.score,
          payload: r.payload ?? {},
        }));
      } catch (err) {
        console.warn(`[aether:qdrant] Search failed, falling back to local:`, err);
        return this._localSearch(vector, limit);
      }
    }

    return this._localSearch(vector, limit);
  }

  /**
   * 根据 ID 删除记录
   */
  async delete(id: string): Promise<void> {
    if (this.qdrant) {
      try {
        await this.qdrant.delete(this.config.collection, { points: [id] });
      } catch { /* ignore */ }
    }
    this.localCache.delete(id);
  }

  /**
   * 获取记录数
   */
  async count(): Promise<number> {
    if (this.qdrant) {
      try {
        const info = await this.qdrant.getCollectionInfo(this.config.collection);
        return info?.result?.vectors_count ?? this.localCache.size;
      } catch {
        return this.localCache.size;
      }
    }
    return this.localCache.size;
  }

  /**
   * 刷新本地缓存到磁盘
   */
  private _flush(): void {
    if (this.localCache.size === 0) return;

    try {
      if (!existsSync(this.config.persistencePath)) {
        mkdirSync(this.config.persistencePath, { recursive: true });
      }
      const path = join(this.config.persistencePath, 'qdrant-cache.jsonl');
      const lines = Array.from(this.localCache.values()).map(r => JSON.stringify(r)).join('\n');
      writeFileSync(path, lines, 'utf-8');
    } catch (err) {
      console.warn('[aether:qdrant] Flush failed:', err);
    }
  }

  private _loadLocalCache(): void {
    try {
      const path = join(this.config.persistencePath, 'qdrant-cache.jsonl');
      if (!existsSync(path)) return;
      const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const r = JSON.parse(line) as QdrantRecord;
          this.localCache.set(r.id, r);
        } catch { /* skip malformed */ }
      }
      console.log(`[aether:qdrant] 📂 Loaded ${this.localCache.size} cached records`);
    } catch { /* ignore */ }
  }

  private async _ensureCollection(): Promise<void> {
    if (!this.qdrant) return;
    try {
      const info = await this.qdrant.getCollectionInfo(this.config.collection);
      if (!info) {
        await this.qdrant.createCollection(this.config.collection, {
          vectors: { size: this.config.vectorSize, distance: 'Cosine' },
        });
        console.log(`[aether:qdrant] 📦 Created collection: ${this.config.collection}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('already exists')) {
        console.warn(`[aether:qdrant] Collection creation warning:`, msg);
      }
    }
  }

  private _localSearch(vector: number[], limit: number): SearchResult[] {
    const entries = Array.from(this.localCache.values());
    const scored = entries.map(e => ({
      id: e.id,
      score: this._cosineSim(vector, e.vector),
      payload: e.payload,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).filter(r => r.score > 0.01);
  }

  private _cosineSim(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom < 1e-9 ? 0 : dot / denom;
  }

  stats(): { mode: string; cachedRecords: number; collection: string } {
    return {
      mode: this.qdrant ? 'qdrant' : 'local-cache',
      cachedRecords: this.localCache.size,
      collection: this.config.collection,
    };
  }
}
