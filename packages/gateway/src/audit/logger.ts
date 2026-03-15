// Audit Logger - 审计日志记录器
// 记录所有 Gateway 操作，支持 SOC2 格式输出

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface AuditEntry {
  action: string;
  source: string;
  ok: boolean;
  detail?: string;
  metadata?: Record<string, unknown>;
}

interface AuditRecord extends AuditEntry {
  id: string;
  timestamp: string;
  system: 'aether-gateway';
}

export class AuditLogger {
  private logDir: string;
  private buffer: AuditRecord[] = [];
  private readonly FLUSH_INTERVAL_MS = 2000;

  constructor() {
    this.logDir = process.env.AUDIT_LOG_DIR ?? './runtime/audit';
    this.ensureDir();
    setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS);
  }

  private ensureDir() {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  log(entry: AuditEntry) {
    const record: AuditRecord = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      system: 'aether-gateway',
    };

    this.buffer.push(record);

    // 失败事件立即刷盘
    if (!entry.ok) {
      this.flush();
    }
  }

  private flush() {
    if (this.buffer.length === 0) return;

    const today = new Date().toISOString().split('T')[0];
    const logFile = join(this.logDir, `${today}.jsonl`);

    try {
      const lines = this.buffer.map((r) => JSON.stringify(r)).join('\n') + '\n';
      appendFileSync(logFile, lines, 'utf-8');
      this.buffer = [];
    } catch (err) {
      console.error('[aether:audit] Failed to flush logs:', err);
    }
  }

  /**
   * 查询审计日志（内存中的最近记录）
   */
  recent(limit = 50): AuditRecord[] {
    return this.buffer.slice(-limit);
  }

  /**
   * 获取今天的日志文件路径
   */
  todayLogPath(): string {
    const today = new Date().toISOString().split('T')[0];
    return join(this.logDir, `${today}.jsonl`);
  }
}
