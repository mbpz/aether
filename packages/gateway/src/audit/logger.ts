// Audit Logger - SOC2-Compliant Audit Logging
// 记录所有 Gateway 操作，支持 SOC2 兼容格式输出
// - 不可变日志条目（HMAC-SHA256 hash chaining）
// - 操作分类 (action categories)
// - 执行者 attribution
// - 防篡改验证
// - 保留策略

import { appendFileSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { createHmac, createHash, randomUUID } from 'crypto';
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

export interface RetentionPolicy {
  maxAgeDays: number;
  maxFileSizeMB: number;
}

export interface IntegrityResult {
  valid: boolean;
  entriesVerified: number;
  errors: string[];
  firstInvalidEntry?: number;
}

export interface RetentionResult {
  deleted: number;
  errors: string[];
}

// ── Audit Logger ──────────────────────────────────────────────────────────────


// Resolve the audit-log signing key with strict fail-closed semantics.
//
// Resolution order:
//   1. `options.signingKey` if explicitly passed (used by tests and
//      embedded deployments that already have a managed secret).
//   2. `AUDIT_SIGNING_KEY` env var if non-empty.
//   3. `AUDIT_SIGNING_KEY_FILE` env var pointing to a file containing
//      the raw key bytes (truncated at the first NUL or newline).
//
// If none of the above produce a non-empty key, the constructor throws.
// The previous behaviour of falling back to the literal string
// "default-signing-key" silently disabled tamper-detection and has been
// removed. Operators MUST now configure a key, or the gateway refuses to
// start.
function resolveSigningKey(explicit: string | undefined): Buffer {
  const candidates: Array<string | undefined> = [explicit];
  if (process.env.AUDIT_SIGNING_KEY && process.env.AUDIT_SIGNING_KEY.length > 0) {
    candidates.push(process.env.AUDIT_SIGNING_KEY);
  }
  const filePath = process.env.AUDIT_SIGNING_KEY_FILE;
  if (filePath && filePath.length > 0) {
    try {
      const fs = require('fs') as typeof import('fs');
      const raw = fs.readFileSync(filePath, 'utf-8');
      const trimmed = raw.split(/[\r\n\0]/, 1)[0] ?? '';
      candidates.push(trimmed);
    } catch (err) {
      // fall through to the final missing-key check below; the error is
      // surfaced as part of the diagnostic message.
      candidates.push(undefined);
    }
  }
  for (const c of candidates) {
    if (typeof c === 'string' && c.length >= 32) {
      return Buffer.from(c, 'utf-8');
    }
  }
  throw new Error(
    'AuditLogger: no signing key configured. Set AUDIT_SIGNING_KEY (>=32 chars) ' +
    'or AUDIT_SIGNING_KEY_FILE, or pass `signingKey` to the constructor. ' +
    'Refusing to start because HMAC chain integrity would be disabled.',
  );
}

export class AuditLogger {
  private logDir: string;
  private buffer: AuditRecord[] = [];
  private sequence = 0;
  private lastHash = 'GENESIS';
  private signingKey: Buffer;
  private retentionPolicy: RetentionPolicy;

  private readonly FLUSH_INTERVAL_MS = 2000;
  private readonly LOG_VERSION = 1;
  private readonly DEFAULT_RETENTION_DAYS = 90;
  private readonly DEFAULT_MAX_FILE_SIZE_MB = 100;

  constructor(options?: {
    logDir?: string;
    signingKey?: string;
    retentionPolicy?: Partial<RetentionPolicy>;
  }) {
    this.logDir = options?.logDir ?? process.env.AUDIT_LOG_DIR ?? './runtime/audit';
    const resolvedKey = resolveSigningKey(options?.signingKey);
    this.signingKey = resolvedKey;
    this.retentionPolicy = {
      maxAgeDays: options?.retentionPolicy?.maxAgeDays ?? this.DEFAULT_RETENTION_DAYS,
      maxFileSizeMB: options?.retentionPolicy?.maxFileSizeMB ?? this.DEFAULT_MAX_FILE_SIZE_MB,
    };

    this.ensureDir();
    this._loadLastHash(); // 从上次日志恢复hash链
    setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS);
    // Apply retention policy daily
    setInterval(() => this.applyRetentionPolicy(), 24 * 60 * 60 * 1000);
  }

  private ensureDir() {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Restore lastHash from existing logs, preserving chain continuity across
   * files. Starts at the tail of the last file and walks backwards to find
   * the last *valid* record — if internal tampering is detected in the tail
   * file we fall back to GENESIS so new entries still form a correct (if
   * disconnected) chain rather than building on corrupted state.
   *
   * Before trusting the loaded hash, we verify the last file's internal
   * chain. If an earlier file in the sequence was tampered with, the
   * verification gap is detected by verifyLogIntegrity() — but new writes
   * must never extend a broken link.
   */
  private _loadLastHash() {
    try {
      const logFiles = this._getLogFiles();
      if (logFiles.length === 0) return;

      const lastFile = logFiles[logFiles.length - 1];
      const lines = readFileSync(lastFile, 'utf-8').split('\n').filter(Boolean);
      if (lines.length === 0) return;

      // Verify this file's internal chain before trusting its tail hash.
      let prev = 'GENESIS';
      let lastGoodRecord: AuditRecord | null = null;
      for (const line of lines) {
        const rec = JSON.parse(line) as AuditRecord;
        if (rec.previousHash !== prev) {
          // Chain broken in this file — start fresh from GENESIS.
          return;
        }
        // Re-compute the hash to detect silent tampering.
        const { hash, ...data } = rec;
        const expected = this._computeHash(data as Omit<AuditRecord, 'hash'>);
        if (expected !== hash) {
          return;
        }
        prev = rec.hash;
        lastGoodRecord = rec;
      }

      if (lastGoodRecord) {
        this.sequence = lastGoodRecord.sequence + 1;
        this.lastHash = lastGoodRecord.hash;
      }
    } catch {
      // Parse/read error — start from GENESIS.
    }
  }

  /**
   * Get sorted list of log files
   */
  private _getLogFiles(): string[] {
    if (!existsSync(this.logDir)) return [];

    return readdirSync(this.logDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => join(this.logDir, f))
      .sort();
  }

  /**
   * 计算条目的HMAC-SHA256 hash
   * Uses: HMAC-SHA256(signingKey, previousHash + entryData)
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
      metadata: record.metadata,
      ipAddress: record.ipAddress,
      userAgent: record.userAgent,
    }, Object.keys({
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
      metadata: record.metadata,
      ipAddress: record.ipAddress,
      userAgent: record.userAgent,
    }).sort());

    // Create chain: HMAC-SHA256(signingKey, previousHash + SHA256(entryData))
    const entryHash = createHash('sha256').update(data).digest('hex');
    const chainData = `${record.previousHash}:${entryHash}`;

    return createHmac('sha256', this.signingKey).update(chainData).digest('hex');
  }

  /**
   * 记录审计日志
   */
  log(entry: AuditEntry): string {
    if (entry._skipLog) return '';

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

    return record.id;
  }

  private flush(): number {
    if (this.buffer.length === 0) return 0;

    const today = new Date().toISOString().split('T')[0];
    const logFile = join(this.logDir, `${today}.jsonl`);

    try {
      const lines = this.buffer.map((r) => JSON.stringify(r)).join('\n') + '\n';
      appendFileSync(logFile, lines, 'utf-8');
      const count = this.buffer.length;
      this.buffer = [];
      return count;
    } catch (err) {
      console.error('[aether:audit] Failed to flush logs:', err);
      return 0;
    }
  }

  /**
   * 查询审计日志（内存中的最近记录）
   * `limit` is clamped to [1, MAX_RECENT] to bound memory and payload size.
   */
  static readonly MAX_RECENT = 500;
  recent(limit = 50): AuditRecord[] {
    const safe = Math.min(Math.max(Math.floor(limit) || 50, 1), AuditLogger.MAX_RECENT);
    return this.buffer.slice(-safe);
  }

  /**
   * 获取今天的日志文件路径
   */
  todayLogPath(): string {
    const today = new Date().toISOString().split('T')[0];
    return join(this.logDir, `${today}.jsonl`);
  }

  /**
   * 获取所有日志文件路径
   */
  logFilePaths(): string[] {
    return this._getLogFiles();
  }

  /**
   * 验证日志文件完整性 (SOC2)
   * 从前往后验证每个条目的HMAC-SHA256 hash链
   */
  verifyLogIntegrity(): IntegrityResult {
    const logFiles = this._getLogFiles();
    const errors: string[] = [];
    let entriesVerified = 0;
    let previousHash = 'GENESIS';

    for (const file of logFiles) {
      let fileValid = true;

      try {
        const content = readFileSync(file, 'utf-8');
        const lines = content.split('\n').filter(Boolean);

        for (let i = 0; i < lines.length; i++) {
          let record: AuditRecord;

          // Parse check
          try {
            record = JSON.parse(lines[i]) as AuditRecord;
          } catch {
            errors.push(`${file}:${i + 1} - JSON parse error`);
            fileValid = false;
            break;
          }

          // Hash chain continuity check
          if (record.previousHash !== previousHash) {
            errors.push(
              `${file}:${i + 1} - Hash chain broken (expected previousHash: ${previousHash}, got: ${record.previousHash})`
            );
            fileValid = false;
            break;
          }

          // Re-compute and verify HMAC-SHA256 hash
          const { hash, ...recordData } = record;
          const computed = this._computeHash(recordData as Omit<AuditRecord, 'hash'>);

          if (computed !== hash) {
            errors.push(
              `${file}:${i + 1} - Hash mismatch (entry may have been tampered with)` +
              `\n    Expected: ${computed}\n    Got:      ${hash}`
            );
            fileValid = false;
            break;
          }

          previousHash = record.hash;
          entriesVerified++;
        }
      } catch (err) {
        errors.push(`${file} - Read error: ${err}`);
      }

      if (!fileValid && errors.length > 0) {
        const firstError = errors[errors.length - 1];
        const match = firstError.match(/:(\d+)/);
        const firstInvalidEntry = match ? parseInt(match[1], 10) : undefined;

        return {
          valid: false,
          entriesVerified,
          errors,
          firstInvalidEntry,
        };
      }
    }

    return {
      valid: errors.length === 0,
      entriesVerified,
      errors,
    };
  }

  /**
   * 获取指定时间范围内的审计日志
   */
  queryByTimeRange(startTime: string, endTime: string): AuditRecord[] {
    const results: AuditRecord[] = [];
    const logFiles = this._getLogFiles();

    for (const file of logFiles) {
      try {
        const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
        const filtered = lines
          .map((l) => JSON.parse(l) as AuditRecord)
          .filter((r) => r.timestamp >= startTime && r.timestamp <= endTime);
        results.push(...filtered);
      } catch {
        // Skip unreadable files
      }
    }

    return results;
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

  /**
   * 获取保留策略设置
   */
  getRetentionPolicy(): RetentionPolicy {
    return { ...this.retentionPolicy };
  }

  /**
   * 应用保留策略 - 删除过期日志文件
   */
  applyRetentionPolicy(): RetentionResult {
    const maxAgeMs = this.retentionPolicy.maxAgeDays * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - maxAgeMs);
    const logFiles = this._getLogFiles();
    let deleted = 0;
    const errors: string[] = [];

    for (const file of logFiles) {
      try {
        const stats = statSync(file);
        const fileDate = new Date(stats.mtime);

        if (fileDate < cutoffDate) {
          unlinkSync(file);
          deleted++;
        }
      } catch (err) {
        errors.push(`Failed to process ${file}: ${err}`);
      }
    }

    return { deleted, errors };
  }

  /**
   * 强制刷新缓冲区
   */
  forceFlush(): number {
    return this.flush();
  }
}

// ── Singleton Instance ───────────────────────────────────────────────────────

let defaultLogger: AuditLogger | null = null;

export function getAuditLogger(options?: {
  logDir?: string;
  signingKey?: string;
  retentionPolicy?: Partial<RetentionPolicy>;
}): AuditLogger {
  if (!defaultLogger) {
    defaultLogger = new AuditLogger(options);
  }
  return defaultLogger;
}

export function resetAuditLogger(): void {
  defaultLogger = null;
}