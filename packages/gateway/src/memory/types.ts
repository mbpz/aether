// EP-04: 分层记忆系统 — 类型定义

export type MemoryTier = 'working' | 'episodic' | 'semantic';

export interface MemoryEntry {
  id: string;
  tier: MemoryTier;
  content: string;
  metadata: {
    source?: string;       // 来源：'user' | 'agent' | 'exec' | 'skill'
    sessionId?: string;
    taskId?: string;
    tags?: string[];
    importance?: number;   // 0-1，用于遗忘策略
    compactedFrom?: string[]; // L2→L3 压缩时记录的源事件 id 列表
  };
  embedding?: number[];    // TF-IDF 向量（L3 语义层）
  createdAt: string;
  accessedAt: string;
  accessCount: number;
}

export interface MemoryQuery {
  text?: string;           // 语义搜索
  tier?: MemoryTier;
  tags?: string[];
  source?: string;
  sessionId?: string;
  limit?: number;
  minImportance?: number;
}

export interface MemoryQueryResult {
  entries: Array<MemoryEntry & { score?: number }>;
  total: number;
  queryMs: number;
}

export interface MemoryStats {
  working: { count: number; tokens: number };
  episodic: { count: number; sizeBytes: number };
  semantic: {
    count: number;
    vocabSize: number;
    mode: 'ollama+qdrant' | 'tfidf-fallback';
    embeddingProvider?: { cachedEmbeddings: number; dimension: number; model: string };
    vectorStore?: { mode: string; cachedRecords: number; collection: string };
  };
  total: number;
}

// ── Memory Compaction (L2 → L3) ─────────────────────────────────────────────

export interface MemoryCompactionConfig {
  /** Enable background compaction (default: false) */
  enabled?: boolean;
  /** Interval between compaction runs in ms (default: 3600000 = 1 hour) */
  intervalMs?: number;
  /** Minimum L2 events before triggering compaction (default: 10) */
  minEventsToCompact?: number;
  /** Maximum L2 events to process per compaction run (default: 100) */
  maxEventsPerCompaction?: number;
}

export interface CompactionResult {
  compacted: number;       // Number of L2 events processed
  knowledgeExtracted: number; // Number of L3 entries created
  sessionGroups: number;  // Number of session/topic groups formed
  durationMs: number;     // Time taken for this compaction run
  usingLlm: boolean;       // Whether LLM summarization was used
  skipped: boolean;        // True if skipped due to insufficient events
}

/** State for tracking compaction progress */
export interface CompactionState {
  lastCompactionTimestamp: string | null;  // ISO timestamp; only events after this are processed
  eventsSinceLastCompaction: number;       // Count of new L2 events
  totalCompactions: number;                // Total compaction runs performed
  totalEventsCompacted: number;            // Cumulative events compacted
  totalKnowledgeExtracted: number;         // Cumulative L3 entries created
  lastResult: CompactionResult | null;     // Result of last run
}
