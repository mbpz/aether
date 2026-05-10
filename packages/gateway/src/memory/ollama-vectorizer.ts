// EP-04: Ollama Dense Embedding
// 使用 Ollama + nomic-embed-text 生成密集语义向量
// 替换 TF-IDF 的稀疏向量，实现更高质量的 L3 语义检索

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// ── 类型定义 ─────────────────────────────────────────────────────────────

export interface OllamaConfig {
  baseUrl?: string;          // Ollama 服务器地址，默认 http://localhost:11434
  model?: string;            // 嵌入模型，默认 nomic-embed-text
  dimension?: number;        // 向量维度（用于验证），默认 768
  timeoutMs?: number;        // 请求超时，默认 30s
}

export interface EmbedResult {
  embedding: number[];
  model: string;
  durationMs: number;
}

// ── Ollama 向量器 ────────────────────────────────────────────────────────

export class OllamaVectorizer {
  private config: Required<OllamaConfig>;
  private cache = new Map<string, number[]>();  // content → embedding 缓存
  private _dimension: number;

  constructor(config: OllamaConfig = {}) {
    this.config = {
      baseUrl: config.baseUrl ?? 'http://localhost:11434',
      model: config.model ?? 'nomic-embed-text',
      dimension: config.dimension ?? 768,
      timeoutMs: config.timeoutMs ?? 30_000,
    };
    this._dimension = this.config.dimension;
    console.log(`[aether:ollama-vectorizer] ✅ Ollama vectorizer ready`);
    console.log(`[aether:ollama-vectorizer]   baseUrl=${this.config.baseUrl}`);
    console.log(`[aether:ollama-vectorizer]   model=${this.config.model}`);
  }

  get dimension(): number { return this._dimension; }
  get documentCount(): number { return this.cache.size; }

  /**
   * 生成文本的嵌入向量
   */
  async vectorize(text: string): Promise<number[]> {
    // 缓存命中
    const cacheKey = text.slice(0, 200);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const t0 = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const resp = await fetch(`${this.config.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.model, prompt: text }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!resp.ok) {
        throw new Error(`Ollama API error: ${resp.status} ${resp.statusText}`);
      }

      const json = await resp.json() as { embedding?: number[]; error?: string };
      if (json.error) {
        throw new Error(`Ollama embedding error: ${json.error}`);
      }

      if (!json.embedding || !Array.isArray(json.embedding)) {
        throw new Error(`Invalid embedding response from Ollama`);
      }

      const embedding = json.embedding;
      this.cache.set(cacheKey, embedding);

      if (embedding.length !== this._dimension) {
        this._dimension = embedding.length; // 动态适应实际维度
      }

      const durationMs = Date.now() - t0;
      console.log(`[aether:ollama-vectorizer] ✅ Embedded ${text.length} chars → ${embedding.length}d in ${durationMs}ms`);

      return embedding;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort')) {
        throw new Error(`Ollama embedding timed out after ${this.config.timeoutMs}ms`);
      }
      throw new Error(`Ollama embedding failed: ${msg}`);
    }
  }

  /**
   * 批量嵌入（多条文本）
   */
  async batchVectorize(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.vectorize(t)));
  }

  /**
   * 计算余弦相似度
   */
  cosineSim(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot   += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom < 1e-9 ? 0 : dot / denom;
  }

  /**
   * 测试 Ollama 连通性
   */
  async ping(): Promise<{ ok: boolean; model: string; latencyMs: number; error?: string }> {
    const t0 = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      const resp = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      });
      clearTimeout(timeout);
      const latencyMs = Date.now() - t0;

      if (!resp.ok) {
        return { ok: false, model: '', latencyMs, error: `HTTP ${resp.status}` };
      }

      const json = await resp.json() as { models?: Array<{ name: string }> };
      const models = json.models ?? [];
      const hasEmbedding = models.some(m => m.name.includes('embed'));

      return {
        ok: true,
        model: `${this.config.model} (available: ${models.map(m => m.name).join(', ')})`,
        latencyMs,
        error: hasEmbedding ? undefined : 'No embedding model found in Ollama',
      };
    } catch (err: unknown) {
      return {
        ok: false,
        model: '',
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 持久化缓存到文件（用于重启后复用）
   */
  saveCache(dir = './memory-store'): void {
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const path = join(dir, 'ollama-embed-cache.json');
      const data: Record<string, number[]> = {};
      for (const [k, v] of this.cache) data[k] = v;
      writeFileSync(path, JSON.stringify(data), 'utf-8');
      console.log(`[aether:ollama-vectorizer] 💾 Saved ${this.cache.size} cached embeddings to ${path}`);
    } catch (err) {
      console.warn('[aether:ollama-vectorizer] Failed to save cache:', err);
    }
  }

  /**
   * 从文件加载缓存
   */
  loadCache(dir = './memory-store'): number {
    try {
      const path = join(dir, 'ollama-embed-cache.json');
      if (!existsSync(path)) return 0;
      const raw = readFileSync(path, 'utf-8');
      const data = JSON.parse(raw) as Record<string, number[]>;
      for (const [k, v] of Object.entries(data)) this.cache.set(k, v);
      console.log(`[aether:ollama-vectorizer] 📂 Loaded ${Object.keys(data).length} cached embeddings`);
      return Object.keys(data).length;
    } catch (err) {
      console.warn('[aether:ollama-vectorizer] Failed to load cache:', err);
      return 0;
    }
  }

  stats(): { cachedEmbeddings: number; dimension: number; model: string } {
    return {
      cachedEmbeddings: this.cache.size,
      dimension: this._dimension,
      model: this.config.model,
    };
  }
}
