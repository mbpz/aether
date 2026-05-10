// EP-05: MessageBus - 内存队列 + AES-256-GCM 加密 + 订阅机制
// 消息持久化到 .agent-workspace/bus.jsonl
// 加密层：使用 EphemeralKeyManager 管理会话密钥

import { randomUUID } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { EphemeralKeyManager, encryptPayload, decryptPayload, type EncryptedPayload } from './crypto.js';

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

  /** agentId → 会话密钥（每个 Agent 独立密钥） */
  private keyManager: EphemeralKeyManager;

  /** JSONL 持久化路径 */
  private busFilePath: string;

  constructor(opts: { busFilePath?: string; keyManager?: EphemeralKeyManager } = {}) {
    const defaultPath = resolve(process.cwd(), '.agent-workspace/bus.jsonl');
    this.busFilePath = opts.busFilePath ?? defaultPath;
    this.keyManager = opts.keyManager ?? new EphemeralKeyManager();
    this._ensureDir();
    console.log(`[aether:message-bus] ✅ MessageBus initialized (persist: ${this.busFilePath})`);
  }

  /**
   * 为指定 Agent 创建会话密钥（注册时调用）
   */
  createSession(agentId: string): string {
    const key = this.keyManager.createSession(agentId);
    return key.keyId;
  }

  /**
   * 获取指定 Agent 的活跃密钥
   */
  getSessionKey(agentId: string): ReturnType<EphemeralKeyManager['getKey']> {
    // 遍历查找（简化实现，生产中可用 agentId→keyId 映射）
    for (const key of this.keyManager['keys'].values()) {
      if (key.agentId === agentId) return key;
    }
    return null;
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
   * @param msg 要发布的消息（payload 可选加密）
   * @param encryptPayloadsByKey 发送方 agentId → SessionKey 映射，用于加密
   */
  publish(
    msg: Omit<Message, 'id' | 'timestamp' | 'encrypted'> & {
      id?: string;
      timestamp?: string;
      encrypted?: boolean;
    },
    senderKey?: ReturnType<EphemeralKeyManager['getKey']>
  ): Message {
    const full: Message = {
      id: msg.id ?? randomUUID(),
      from: msg.from,
      to: msg.to,
      type: msg.type,
      payload: msg.payload,
      timestamp: msg.timestamp ?? new Date().toISOString(),
      encrypted: false,
    };

    // 如果发送方有密钥且 payload 未加密，则加密之
    if (senderKey && !msg.encrypted && msg.payload !== null) {
      const encrypted = encryptPayload(msg.payload, senderKey);
      full.payload = encrypted;
      full.encrypted = true;
      full.keyId = senderKey.keyId;
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
      `[aether:message-bus] 📨 ${full.from} → ${full.to} [${full.type}] encrypted=${full.encrypted} id=${full.id}`
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

    // 尝试解密每条消息
    for (const msg of msgs) {
      if (msg.encrypted && msg.payload) {
        const recipientKey = this.getSessionKey(agentId);
        if (recipientKey) {
          try {
            msg.payload = decryptPayload(msg.payload as EncryptedPayload, recipientKey);
            msg.encrypted = false;
          } catch (err) {
            console.warn(`[aether:message-bus] Decryption failed for message ${msg.id}:`, err instanceof Error ? err.message : String(err));
          }
        }
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
    if (handler) {
      try { handler(msg); } catch (err) {
        console.warn(`[aether:message-bus] Subscriber error for ${agentId}:`, err);
      }
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
