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
  semantic: { count: number; vocabSize: number };
  total: number;
}
