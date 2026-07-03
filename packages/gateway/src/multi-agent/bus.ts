// EP-05: MessageBus - 内存队列 + AES-256-GCM 加密 + 订阅机制
// 消息持久化到 .agent-workspace/bus.jsonl
// 加密层：使用 EphemeralKeyManager 管理会话密钥
//
// SHELF STATUS (Council Verdict 2026-07-02): Real code, production-wired via
// routes/multi-agent.ts. Pre-competent — no external usage verified. If zero
// external signal by 2026-08-15, this directory moves to multi-agent/archive/.
// The bus subscriber decryption fix (2026-07-02) resolves the last known bug
// where subscribers received ciphertext instead of plaintext.

import { randomUUID } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { EphemeralKeyManager, encryptPayload, decryptPayload, type EncryptedPayload, type SessionKey } from './crypto.js';

// ── 类型定义 ─────────────────────────────────────────────────────────────────

export type MessageType = 'task' | 'result' | 'issue' | 'heartbeat';

export interface Message {
  id: string;
  from: string;
  to: string;           // agentId 或 '*' 广播
  type: MessageType;
  payload: unknown;    // 加密后为 EncryptedPayload，明文时为任意类型
  timestamp: string;
  encrypted: boolean;  // true = payload 是 EncryptedPayload
  keyId?: string;       // 发送方使用的密钥 ID（用于接收方解密）
}

export type MessageHandler = (msg: Message) => void;

// ── MessageBus ────────────────────────────────────────────────────────────────

export class MessageBus {
  /** agentId → 待取消息队列 */
  private queues = new Map<string, Message[]>();

  /** agentId → 事件订阅回调 */
  private subscribers = new Map<string, MessageHandler>();

  /** agentId → keyId 反向索引，避免每次按 keyId 扫描全表 */
  private agentKeyIndex = new Map<string, string>();

  /** agentId → 会话密钥（每个 Agent 独立密钥） */
  private keyManager: EphemeralKeyManager;

  /** JSONL 持久化路径 */
  private busFilePath: string;

  /**
   * When true (the default), every `publish` call without a sender key
   * is rejected. This prevents the previous footgun where the bus would
   * silently downgrade to plaintext if the caller forgot to pass a key.
   */
  private requireSenderKey: boolean;

  constructor(opts: {
    busFilePath?: string;
    keyManager?: EphemeralKeyManager;
    requireSenderKey?: boolean;
  } = {}) {
    const defaultPath = resolve(process.cwd(), '.agent-workspace/bus.jsonl');
    this.busFilePath = opts.busFilePath ?? defaultPath;
    this.keyManager = opts.keyManager ?? new EphemeralKeyManager();
    this.requireSenderKey = opts.requireSenderKey ?? true;
    this._ensureDir();
    console.log(`[aether:message-bus] ✅ MessageBus initialized (persist: ${this.busFilePath}, requireSenderKey=${this.requireSenderKey})`);
  }

  /**
   * 为指定 Agent 创建会话密钥（注册时调用）
   */
  createSession(agentId: string): string {
    const key = this.keyManager.createSession(agentId);
    this.agentKeyIndex.set(agentId, key.keyId);
    return key.keyId;
  }

  /**
   * 获取指定 Agent 的活跃密钥
   */
  getSessionKey(agentId: string): SessionKey | null {
    const keyId = this.agentKeyIndex.get(agentId);
    if (!keyId) return null;
    return this.keyManager.getKey(keyId);
  }

  /**
   * 预初始化指定 Agent 的消息队列
   */
  ensureQueue(agentId: string): void {
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, []);
    }
  }

  /**
   * 发布消息
   *
   * The sender is required to have an active session key unless the bus
   * was explicitly constructed with `requireSenderKey: false`. When a
   * sender key is available, the payload is encrypted in-place before
   * being persisted and queued, so plaintext never hits disk or memory.
   *
   * @throws if the bus requires a sender key and the caller did not pass
   *         one (directly or via the `from` field).
   */
  publish(
    msg: Omit<Message, 'id' | 'timestamp' | 'encrypted'> & {
      id?: string;
      timestamp?: string;
      encrypted?: boolean;
    },
    senderKey?: SessionKey
  ): Message {
    // Resolve the effective key: explicit argument wins, otherwise look up
    // by `from` agentId. Either way we fail fast when no key is available
    // and the bus is in strict mode.
    let effectiveKey: SessionKey | null = senderKey ?? null;
    if (!effectiveKey && msg.from && msg.from !== 'orchestrator') {
      effectiveKey = this.getSessionKey(msg.from);
    }

    if (!effectiveKey && this.requireSenderKey) {
      throw new Error(
        `MessageBus.publish: refusing to send ${msg.type} from '${msg.from}' to '${msg.to}' ` +
        `without an active session key. Call createSession(agentId) first or pass an explicit key.`,
      );
    }

    const full: Message = {
      id: msg.id ?? randomUUID(),
      from: msg.from,
      to: msg.to,
      type: msg.type,
      payload: msg.payload,
      timestamp: msg.timestamp ?? new Date().toISOString(),
      encrypted: false,
    };

    // If we have a key and the payload is not already encrypted, encrypt
    // it now. `null` payloads are kept as-is (control messages that carry
    // no information besides the envelope).
    if (effectiveKey && !msg.encrypted && msg.payload !== null && msg.payload !== undefined) {
      const encrypted = encryptPayload(msg.payload, effectiveKey);
      full.payload = encrypted;
      full.encrypted = true;
      full.keyId = effectiveKey.keyId;
    } else if (msg.encrypted) {
      // Caller explicitly marked the payload as already encrypted; copy
      // the keyId through so receivers can decrypt.
      full.encrypted = true;
      if (msg.keyId) full.keyId = msg.keyId;
    }

    // 路由到收件人队列
    if (full.to === '*') {
      for (const [agentId, queue] of this.queues) {
        if (agentId !== full.from) {
          queue.push(full);
          this._notifySubscriber(agentId, full);
        }
      }
    } else {
      if (!this.queues.has(full.to)) {
        this.queues.set(full.to, []);
      }
      this.queues.get(full.to)!.push(full);
      this._notifySubscriber(full.to, full);
    }

    this._persist(full);

    console.log(
      `[aether:message-bus] 📨 ${full.from} → ${full.to} [${full.type}] encrypted=${full.encrypted} id=${full.id}`,
    );
    return full;
  }

  /**
   * 拉取指定 Agent 的待处理消息（清空队列）
   * 自动尝试用该 Agent 的密钥解密 payload
   */
  consume(agentId: string, limit = 50): Message[] {
    const queue = this.queues.get(agentId) ?? [];
    const msgs = queue.splice(0, limit);

    // The bus holds session keys for every participant, not just the
    // receiver. To decrypt a message we look up the *sender's* key by
    // the keyId carried in the envelope. This is what allows the
    // AES-GCM layer to actually authenticate the sender.
    for (const msg of msgs) {
      if (!msg.encrypted || !msg.payload) continue;
      const senderKey = msg.keyId ? this.keyManager.getKey(msg.keyId) : null;
      if (!senderKey) {
        console.warn(
          `[aether:message-bus] Cannot decrypt message ${msg.id} for ${agentId}: ` +
          `sender key ${msg.keyId ?? '<none>'} not in keyManager (expired or unknown)`,
        );
        continue;
      }
      try {
        msg.payload = decryptPayload(msg.payload as EncryptedPayload, senderKey);
        msg.encrypted = false;
      } catch (err) {
        console.warn(
          `[aether:message-bus] Decryption failed for message ${msg.id} (likely tampered or wrong sender key):`,
          err instanceof Error ? err.message : String(err),
        );
        // Leave the payload encrypted; the caller can drop or surface
        // the error. We do NOT silently fall back to plaintext.
      }
    }

    return msgs;
  }

  /**
   * 查看但不清除消息（peek）
   */
  peek(agentId: string, limit = 50): Message[] {
    return (this.queues.get(agentId) ?? []).slice(0, limit);
  }

  /**
   * 订阅（实时推送，适用于 WS 场景）
   */
  subscribe(agentId: string, handler: MessageHandler): void {
    this.subscribers.set(agentId, handler);
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, []);
    }
  }

  /**
   * 取消订阅
   */
  unsubscribe(agentId: string): void {
    this.subscribers.delete(agentId);
  }

  /**
   * 会话结束：销毁 Agent 的所有密钥
   */
  endSession(agentId: string): number {
    this.agentKeyIndex.delete(agentId);
    return this.keyManager.revokeAgentKeys(agentId);
  }

  /**
   * 从 JSONL 文件加载历史消息（用于调试/重放）
   * 历史消息不解密（密钥已销毁则无法解密）
   */
  loadHistory(limit = 200): Message[] {
    if (!existsSync(this.busFilePath)) return [];
    try {
      const lines = readFileSync(this.busFilePath, 'utf-8')
        .split('\n')
        .filter(Boolean);
      return lines
        .slice(-limit)
        .map((l) => {
          try { return JSON.parse(l) as Message; } catch { return null; }
        })
        .filter((m): m is Message => m !== null);
    } catch {
      return [];
    }
  }

  /**
   * 获取消息总线统计信息
   */
  stats(): { totalQueues: number; pendingMessages: number; subscribers: number; activeKeys: number } {
    let pending = 0;
    for (const q of this.queues.values()) pending += q.length;
    return {
      totalQueues: this.queues.size,
      pendingMessages: pending,
      subscribers: this.subscribers.size,
      activeKeys: this.keyManager.stats().activeKeys,
    };
  }

  // ── 私有方法 ───────────────────────────────────────────────────────────────

  private _notifySubscriber(agentId: string, msg: Message): void {
    const handler = this.subscribers.get(agentId);
    if (!handler) return;

    // Subscribers receive the DECRYPTED payload — the bus holds every
    // participant's session key, so it can transparently decrypt on the
    // subscriber's behalf. Without this, a subscriber reading msg.payload
    // would see the raw EncryptedPayload { keyId, iv, ciphertext, authTag }
    // instead of the original object.
    const delivery = msg.encrypted && msg.payload
      ? this._decryptCopy(msg)
      : msg;

    try { handler(delivery); } catch (err) {
      console.warn(`[aether:message-bus] Subscriber error for ${agentId}:`, err);
    }
  }

  /**
   * Return a shallow copy of `msg` with its payload decrypted in-place on
   * the copy. The original queue message is left untouched so that a later
   * consume() call still sees encrypted=true and can decrypt normally.
   */
  private _decryptCopy(msg: Message): Message {
    const senderKey = msg.keyId ? this.keyManager.getKey(msg.keyId) : null;
    if (!senderKey) {
      // Key expired or unknown — deliver the raw message; the subscriber
      // can decide how to handle the undecryptable payload.
      return { ...msg };
    }
    try {
      const plaintext = decryptPayload(msg.payload as EncryptedPayload, senderKey);
      return { ...msg, payload: plaintext, encrypted: false };
    } catch {
      // Decryption failed (tampered authTag?) — deliver raw.
      return { ...msg };
    }
  }

  private _persist(msg: Message): void {
    try {
      appendFileSync(this.busFilePath, JSON.stringify(msg) + '\n', 'utf-8');
    } catch (err) {
      console.warn('[aether:message-bus] Failed to persist message:', err);
    }
  }

  private _ensureDir(): void {
    const dir = dirname(this.busFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
