---
slug: /architecture/memory
title: Three-tier Memory Model
sidebar_label: Memory
---

# Three-tier Memory Model

Aether stores every agent interaction in a three-tier memory model
designed to balance hot-path latency with long-term recall.

## Tiers

| Tier | Storage | When | Latency | Eviction |
|------|---------|------|---------|----------|
| **L1 Working** | In-process `Map<string, MemoryEntry>` | Hot path (every `remember()`) | O(1) | LRU + importance-thresholded; when working window size is exceeded, the lowest-importance entry is moved to L2 |
| **L2 Episodic** | JSONL files (`<storeDir>/episodic-YYYY-MM-DD.jsonl`) | Session log + cross-session temporal queries | File I/O, ~ms | Never (append-only); old files pruned by `applyRetentionPolicy()` after default 90 days |
| **L3 Semantic** | TF-IDF in-process (default) or Ollama+Qdrant (when `embeddingProvider` and `vectorStore` are wired) | Cross-session semantic search | TF-IDF: in-memory cosine (~µs); Ollama+Qdrant: HTTP roundtrip + cosine (~10ms) | Compacted from L2 via `compactL2toL3()` (auto-batched; runs by default on every gateway startup and every 60 min thereafter if `enableCompaction` was called) |

## Public API

All three tiers are accessible via a single `MemoryManager`:

```typescript
import { MemoryManager } from '@aether/gateway/memory';

const mem = new MemoryManager({ storeDir: './memory-store' });

// Write
const entry = mem.remember('Aether is privacy-first', { source: 'docs' });
// → MemoryEntry with id, content, metadata, createdAt, accessedAt, accessCount

// Query
const r = await mem.recall({ text: 'privacy', limit: 5 });
// → { entries, total, queryMs }

// Forget
await mem.forget(entry.id);
// → boolean (true if the entry existed in any tier)

// Working-only operations
mem.clearWorking();                          // empties L1
mem.stats();                                // { working, episodic, semantic, total }

// Compaction
mem.enableCompaction({ intervalMs: 60_000 }); // background L2 → L3
```

## Compaction (L2 → L3)

By default, `MemoryManager` runs in `tfidf-fallback` mode. Every
`compactL2toL3()` invocation:

1. Reads all L2 events since the last compaction.
2. Groups them by session ID (with a 1-hour window fallback for
   events without a session).
3. Extracts candidate "facts" — lines that mention code, actions,
   errors, or config keywords — using the bundled NLP heuristic.
4. Adds each fact to L3 as a `MemoryEntry` with `metadata.compactedFrom`
   pointing to the source event IDs.

Optional `LLMProvider` integration: if a `LLMProvider` is wired
when `enableCompaction` is called, the planner uses it to extract
more sophisticated facts (semantic dedup, topic grouping). Without
LLM, the bundled regex-based heuristic is used.

## Implementation

| File | Role |
|------|------|
| [`packages/gateway/src/memory/manager.ts`](https://github.com/aether/aether/blob/main/packages/gateway/src/memory/manager.ts) | `MemoryManager` class — the public API. Owns the working Map, episodic files, and (delegated) the vector store. |
| [`packages/gateway/src/memory/vectorizer.ts`](https://github.com/aether/aether/blob/main/packages/gateway/src/memory/vectorizer.ts) | `TFIDFVectorizer` — pure-JS TF-IDF implementation. |
| [`packages/gateway/src/memory/ollama-vectorizer.ts`](https://github.com/aether/aether/blob/main/packages/gateway/src/memory/ollama-vectorizer.ts) | `OllamaVectorizer` — wraps Ollama's `/api/embeddings` HTTP endpoint. |
| [`packages/gateway/src/memory/qdrant-store.ts`](https://github.com/aether/aether/blob/main/packages/gateway/src/memory/qdrant-store.ts) | `QdrantStore` — wraps Qdrant's HTTP search/upsert API. |

## Testing

The full contract is locked by `manager.test.ts` (16 tests),
`vectorizer.test.ts` (15), `ollama-vectorizer.test.ts` (10), and
`qdrant-store.test.ts` (7). See
[`npm test -- memory/`](https://github.com/aether/aether/tree/main/packages/gateway/src/memory).
