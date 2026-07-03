// EP-05: MessageBus AES-256-GCM 加密层
// 每个 Agent session 拥有独立的临时对称密钥，会话结束后销毁
// Node.js 内置 crypto 模块，无需额外依赖
//
// KNOWN GAP: No dedicated test vectors for encrypt→decrypt round-trip.
// Coverage comes indirectly via bus.test.ts (encrypted publish/consume).
// TODO(B15): Add crypto.test.ts with known-answer vectors + authTag tamper test.

import { randomUUID } from 'crypto';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

export interface SessionKey {
  keyId: string;
  secretKey: Buffer;       // 原始 256-bit 密钥
  encryptedKey?: Buffer;  // 端到端传递时用的加密形式
  agentId: string;
  createdAt: number;
  expiresAt: number;       // TTL 自动销毁
}

export interface EncryptedPayload {
  keyId: string;
  iv: string;              // base64
  ciphertext: string;     // base64
  authTag: string;         // GCM auth tag (16 bytes), base64
}

const KEY_SIZE_BYTES = 32;      // AES-256
const IV_SIZE_BYTES = 12;      // GCM recommended IV
const AUTH_TAG_BYTES = 16;     // GCM auth tag
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 分钟 TTL

// ── 密钥材料派生 ─────────────────────────────────────────────────────────────

/**
 * 从 passphrase + salt 派生 AES-256 密钥
 * 用于端到端加密密钥的密钥交换（KDF）
 */
export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_SIZE_BYTES);
}

/**
 * 生成随机会话密钥
 */
export function generateSessionKey(agentId: string, ttlMs = DEFAULT_TTL_MS): SessionKey {
  const keyId = randomUUID();
  const secretKey = randomBytes(KEY_SIZE_BYTES);
  const now = Date.now();
  return {
    keyId,
    secretKey,
    agentId,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
}

// ── 加密 / 解密 ─────────────────────────────────────────────────────────────

/**
 * 使用 AES-256-GCM 加密 payload
 * @param plaintext  明文数据（任意可序列化对象）
 * @param key        SessionKey 实例
 * @returns EncryptedPayload（不含密钥，keyId 仅用于路由标识）
 */
export function encryptPayload(plaintext: unknown, key: SessionKey): EncryptedPayload {
  const iv = randomBytes(IV_SIZE_BYTES);
  const plaintextStr = JSON.stringify(plaintext);
  const plaintextBuf = Buffer.from(plaintextStr, 'utf8');

  const cipher = createCipheriv('aes-256-gcm', key.secretKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    keyId: key.keyId,
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * 使用 AES-256-GCM 解密 payload
 * @param encrypted  EncryptedPayload 实例
 * @param key        对应的 SessionKey（含 secretKey）
 * @returns 解密后的原始对象
 * @throws 如果 auth tag 验证失败或密钥不匹配
 */
export function decryptPayload(encrypted: EncryptedPayload, key: SessionKey): unknown {
  const iv = Buffer.from(encrypted.iv, 'base64');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');

  if (encrypted.keyId !== key.keyId) {
    throw new Error(`Key ID mismatch: expected ${key.keyId}, got ${encrypted.keyId}`);
  }

  const decipher = createDecipheriv('aes-256-gcm', key.secretKey, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

// ── Ephemeral Key Manager ───────────────────────────────────────────────────

/**
 * 管理所有活跃会话密钥
 * 线程安全（单进程），TTL 过期后自动销毁
 */
export class EphemeralKeyManager {
  private keys = new Map<string, SessionKey>();
  private cleanupIntervalMs = 30_000;

  constructor() {
    setInterval(() => this.cleanup(), this.cleanupIntervalMs);
  }

  /**
   * 创建会话密钥并注册
   */
  createSession(agentId: string, ttlMs = DEFAULT_TTL_MS): SessionKey {
    const key = generateSessionKey(agentId, ttlMs);
    this.keys.set(key.keyId, key);
    return key;
  }

  /**
   * 按 keyId 获取密钥（仅未过期）
   */
  getKey(keyId: string): SessionKey | null {
    const key = this.keys.get(keyId);
    if (!key) return null;
    if (Date.now() > key.expiresAt) {
      this.keys.delete(keyId);
      return null;
    }
    return key;
  }

  /**
   * 销毁指定密钥（主动撤销）
   */
  revokeKey(keyId: string): boolean {
    const deleted = this.keys.delete(keyId);
    if (deleted) {
      console.log(`[aether:key-manager] 🔐 Key ${keyId} revoked`);
    }
    return deleted;
  }

  /**
   * 销毁指定 Agent 的所有密钥（会话结束）
   */
  revokeAgentKeys(agentId: string): number {
    let count = 0;
    for (const [keyId, key] of this.keys) {
      if (key.agentId === agentId) {
        this.keys.delete(keyId);
        count++;
      }
    }
    if (count > 0) {
      console.log(`[aether:key-manager] 🔐 Revoked ${count} key(s) for agent ${agentId}`);
    }
    return count;
  }

  /**
   * 清理过期密钥
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [keyId, key] of this.keys) {
      if (now > key.expiresAt) {
        this.keys.delete(keyId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[aether:key-manager] 🧹 Cleaned up ${cleaned} expired key(s)`);
    }
  }

  stats(): { activeKeys: number; agentCount: number } {
    const agents = new Set(Array.from(this.keys.values()).map(k => k.agentId));
    return {
      activeKeys: this.keys.size,
      agentCount: agents.size,
    };
  }
}
