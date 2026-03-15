// EP-06: 多 Agent 协作 - 消息总线
// 内存队列 + 订阅机制 + JSONL 文件持久化
// 消息持久化到 .agent-workspace/bus.jsonl

import { randomUUID } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export type MessageType = 'task' | 'result' | 'issue' | 'heartbeat';

export interface Message {
  id: string;
  from: string;
  to: string;           // agentId 或 '*' 广播
  type: MessageType;
  payload: unknown;
  timestamp: string;
}

export type MessageHandler = (msg: Message) => void;

// ── MessageBus ────────────────────────────────────────────────────────────────

export class MessageBus {
  /** agentId → 待取消息队列 */
  private queues = new Map<string, Message[]>();

  /** agentId → 事件订阅回调 */
  private subscribers = new Map<string, MessageHandler>();

  /** JSONL 持久化路径 */
  private busFilePath: string;

  constructor(opts: { busFilePath?: string } = {}) {
    // 默认存储到工作区 .agent-workspace/bus.jsonl
    // 使用 process.cwd() 相对路径，避免 import.meta 在 CJS 的问题
    const defaultPath = resolve(process.cwd(), '.agent-workspace/bus.jsonl');
    this.busFilePath = opts.busFilePath ?? defaultPath;
    this._ensureDir();
    console.log(`[aether:message-bus] ✅ MessageBus initialized (persist: ${this.busFilePath})`);
  }

  /**
   * 预初始化指定 Agent 的消息队列。
   * 在 AgentRegistry.register() 时调用，确保广播能投递给所有已注册的 Agent，
   * 即使该 Agent 尚未发送或接收过任何消息。
   */
  ensureQueue(agentId: string): void {
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, []);
    }
  }

  /**
   * 发布消息
   */
  publish(msg: Omit<Message, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): Message {
    const full: Message = {
      id: msg.id ?? randomUUID(),
      from: msg.from,
      to: msg.to,
      type: msg.type,
      payload: msg.payload,
      timestamp: msg.timestamp ?? new Date().toISOString(),
    };

    // 路由到收件人队列
    if (full.to === '*') {
      // 广播：投递给所有已知队列
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

    // 持久化
    this._persist(full);

    console.log(
      `[aether:message-bus] 📨 ${full.from} → ${full.to} [${full.type}] id=${full.id}`
    );
    return full;
  }

  /**
   * 拉取指定 Agent 的待处理消息（清空队列）
   */
  consume(agentId: string, limit = 50): Message[] {
    const queue = this.queues.get(agentId) ?? [];
    const msgs = queue.splice(0, limit);
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
   * 从 JSONL 文件加载历史消息（用于调试/重放）
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
  stats(): { totalQueues: number; pendingMessages: number; subscribers: number } {
    let pending = 0;
    for (const q of this.queues.values()) pending += q.length;
    return {
      totalQueues: this.queues.size,
      pendingMessages: pending,
      subscribers: this.subscribers.size,
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
