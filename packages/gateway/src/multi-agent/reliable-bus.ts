import type { MessageBus, Message } from './bus.js';

export interface ReliableConfig {
  maxRetries?: number;
  baseDelayMs?: number;
}

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

export interface DeadLetterEntry {
  message: Message;
  failedAt: string;
  retryCount: number;
  lastError: string;
}

export class ReliableMessageBus {
  private bus: MessageBus;
  private maxRetries: number;
  private baseDelayMs: number;
  private state: ConnectionState = 'connected';
  private deadLetterQueue: DeadLetterEntry[] = [];
  private retryCount = new Map<string, number>();

  constructor(bus: MessageBus, config: ReliableConfig = {}) {
    this.bus = bus;
    this.maxRetries = config.maxRetries ?? 3;
    this.baseDelayMs = config.baseDelayMs ?? 1000;
  }

  publish(msg: Message): { success: boolean; retryCount: number } {
    const msgKey = `${msg.from}:${msg.to}:${msg.type}`;
    const retries = this.retryCount.get(msgKey) ?? 0;
    try {
      this.bus.publish(msg);
      this.retryCount.delete(msgKey);
      return { success: true, retryCount: retries };
    } catch (err) {
      if (retries < this.maxRetries) {
        this.retryCount.set(msgKey, retries + 1);
        this.state = 'reconnecting';
        return { success: false, retryCount: retries + 1 };
      }
      this.deadLetterQueue.push({ message: msg, failedAt: new Date().toISOString(), retryCount: retries, lastError: String(err) });
      this.state = 'disconnected';
      return { success: false, retryCount: retries };
    }
  }

  consume(recipient: string, limit: number): Message[] {
    return this.bus.consume(recipient, limit);
  }

  getConnectionState(): ConnectionState {
    return this.state;
  }

  reconnect(): Promise<void> {
    this.state = 'connected';
    this.retryCount.clear();
    return Promise.resolve();
  }

  getDeadLetterQueue(): DeadLetterEntry[] {
    return [...this.deadLetterQueue];
  }
}