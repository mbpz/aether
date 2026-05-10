// Audit Logger - SOC2-Compliant Audit Logging
// 记录所有 Gateway 操作，支持 SOC2 兼容格式输出
// - 不可变日志条目（hash chaining）
// - 操作分类 (action categories)
// - 执行者 attribution
// - 防篡改验证

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { join } from 'path';

// ── SOC2 Audit Entry ─────────────────────────────────────────────────────────

export type AuditActionCategory =
  | 'authentication'    // 身份认证
  | 'authorization'    // 权限验证
  | 'data_access'      // 数据访问
  | 'configuration'  // 配置变更
  | 'security'        // 安全事件
  | 'agent_execution' // Agent执行
  | 'vault_operation' // 密钥操作
  | 'network'        // 网络操作
  | 'system';        // 系统事件

export interface AuditActor {
  type: 'user' | 'agent' | 'system';
  id: string;
  label?: string;
}

export interface AuditResource {
  type: string;
  id: string;
}

export interface AuditEntry {
  // 必需字段
  action: string;
  category: AuditActionCategory;
  actor: AuditActor;
  outcome: 'success' | 'failure' | 'partial';
  // 可选字段
  detail?: string;
  resource?: AuditResource;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  // 仅内部使用，不写入日志
  _skipLog?: boolean;
}

interface AuditRecord extends AuditEntry {
  id: string;
  timestamp: string;
  timezone: string;
  sequence: number;
  previousHash: string;
  hash: string;
  system: 'aether-gateway';
  version: 1;
}

// ── Audit Logger ──────────────────────────────────────────────────────────────

export class AuditLogger {
  private logDir: string;
  private buffer: AuditRecord[] = [];
  private sequence = 0;
  private lastHash = 'GENESIS';
  private readonly FLUSH_INTERVAL_MS = 2000;
  private readonly LOG_VERSION = 1;

  constructor() {
    this.logDir = process.env.AUDIT_LOG_DIR ?? './runtime/audit';
    this.ensureDir();
    this._loadLastHash(); // 从上次日志恢复hash链
    setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS);
  }

  private ensureDir() {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * 从最近的日志文件恢复lastHash，保持hash链连续
   */
  private _loadLastHash() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const logFile = join(this.logDir, `${today}.jsonl`);
      if (!existsSync(logFile)) return;

      const lines = readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
      if (lines.length === 0) return;

      const lastLine = lines[lines.length - 1];
      const lastRecord = JSON.parse(lastLine) as AuditRecord;
      this.sequence = lastRecord.sequence + 1;
      this.lastHash = lastRecord.hash;
    } catch {
      // 忽略，日志从GENESIS开始
    }
  }

  /**
   * 计算条目的hash (SHA-256)
   */
  private _computeHash(record: Omit<AuditRecord, 'hash'>): string {
    const data = JSON.stringify({
      id: record.id,
      timestamp: record.timestamp,
      sequence: record.sequence,
      previousHash: record.previousHash,
      action: record.action,
      category: record.category,
      actor: record.actor,
      outcome: record.outcome,
      resource: record.resource,
      detail: record.detail,
    });
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * 记录审计日志
   */
  log(entry: AuditEntry) {
    if (entry._skipLog) return;

    const now = new Date();
    const timestamp = now.toISOString();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const record: AuditRecord = {
      ...entry,
      id: randomUUID(),
      timestamp,
      timezone: tz,
      sequence: this.sequence++,
      previousHash: this.lastHash,
      hash: '', // 先计算
      system: 'aether-gateway',
      version: this.LOG_VERSION,
    };

    record.hash = this._computeHash(record);
    this.lastHash = record.hash;

    this.buffer.push(record);

    // 失败事件立即刷盘
    if (entry.outcome === 'failure') {
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

  /**
   * 验证日志文件完整性 (SOC2)
   * 从后往前验证每个条目的hash链
   */
  verifyLogIntegrity(logPath?: string): {
    valid: boolean;
    errors: string[];
    entriesChecked: number;
  } {
    const path = logPath ?? this.todayLogPath();
    if (!existsSync(path)) {
      return { valid: false, errors: [`Log file not found: ${path}`], entriesChecked: 0 };
    }

    try {
      const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
      const errors: string[] = [];
      let previousHash = 'GENESIS';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let record: AuditRecord;
        try {
          record = JSON.parse(line) as AuditRecord;
        } catch {
          errors.push(`Line ${i + 1}: JSON parse error`);
          continue;
        }

        // 检查hash链
        if (record.previousHash !== previousHash) {
          errors.push(`Line ${i + 1}: Hash chain broken (expected ${previousHash}, got ${record.previousHash})`);
        }

        // 重新计算hash并验证
        const computed = this._computeHash(record);
        if (computed !== record.hash) {
          errors.push(`Line ${i + 1}: Hash mismatch (entry may have been tampered)`);
        }

        previousHash = record.hash;
      }

      return {
        valid: errors.length === 0,
        errors,
        entriesChecked: lines.length,
      };
    } catch (err) {
      return { valid: false, errors: [`Read error: ${err}`], entriesChecked: 0 };
    }
  }

  /**
   * 获取指定时间范围内的审计日志
   */
  queryByTimeRange(startTime: string, endTime: string): AuditRecord[] {
    const path = this.todayLogPath();
    if (!existsSync(path)) return [];

    try {
      const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
      return lines
        .map((l) => JSON.parse(l) as AuditRecord)
        .filter((r) => r.timestamp >= startTime && r.timestamp <= endTime);
    } catch {
      return [];
    }
  }

  /**
   * 按action类别统计
   */
  statsByCategory(): Record<AuditActionCategory, number> {
    const stats = {} as Record<AuditActionCategory, number>;
    for (const rec of this.buffer) {
      stats[rec.category] = (stats[rec.category] ?? 0) + 1;
    }
    return stats;
  }

  /**
   * 获取当前序列号
   */
  currentSequence(): number {
    return this.sequence;
  }
}