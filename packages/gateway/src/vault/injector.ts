// Vault Injector - 凭证临时注入器
// 敏感凭证仅临时加载到内存，不落盘不传云

import { randomUUID } from 'crypto';

interface VaultEntry {
  id: string;
  key: string;
  value: string;
  createdAt: number;
  expiresAt: number; // TTL 过期时间（ms）
  usedBy?: string;   // Agent session ID
}

export class VaultInjector {
  private entries: Map<string, VaultEntry> = new Map();
  private readonly DEFAULT_TTL_MS = 5 * 60 * 1000; // 5分钟默认 TTL

  constructor() {
    // 定期清理过期凭证
    setInterval(() => this.cleanup(), 60 * 1000);
  }

  /**
   * 注入一个凭证，返回临时 ID
   * 凭证只存在于内存中，TTL 过期后自动销毁
   */
  inject(key: string, value: string, ttlMs?: number): string {
    const id = randomUUID();
    const now = Date.now();
    this.entries.set(id, {
      id,
      key,
      value,
      createdAt: now,
      expiresAt: now + (ttlMs ?? this.DEFAULT_TTL_MS),
    });
    console.log(`[aether:vault] Injected secret '${key}' (id=${id}, ttl=${ttlMs ?? this.DEFAULT_TTL_MS}ms)`);
    return id;
  }

  /**
   * 取出凭证（使用一次后标记，可配置是否单次使用）
   */
  resolve(id: string, sessionId?: string): { key: string; value: string } | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(id);
      console.warn(`[aether:vault] Secret ${id} expired and was purged`);
      return null;
    }
    if (sessionId) entry.usedBy = sessionId;
    return { key: entry.key, value: entry.value };
  }

  /**
   * 将凭证作为环境变量 Map 返回（用于注入沙箱）
   */
  resolveAsEnv(ids: string[], sessionId?: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const id of ids) {
      const resolved = this.resolve(id, sessionId);
      if (resolved) {
        env[resolved.key] = resolved.value;
      }
    }
    return env;
  }

  /**
   * 主动销毁一个凭证
   */
  revoke(id: string): boolean {
    const deleted = this.entries.delete(id);
    if (deleted) {
      console.log(`[aether:vault] Secret ${id} revoked`);
    }
    return deleted;
  }

  /**
   * 清理过期凭证
   */
  private cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[aether:vault] Cleaned up ${cleaned} expired secret(s)`);
    }
  }

  stats() {
    return {
      activeSecrets: this.entries.size,
      entries: Array.from(this.entries.values()).map((e) => ({
        id: e.id,
        key: e.key,
        expiresIn: Math.max(0, e.expiresAt - Date.now()),
        usedBy: e.usedBy,
      })),
    };
  }
}
