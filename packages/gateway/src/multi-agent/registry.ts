// EP-06: 多 Agent 协作 - Agent 注册中心
// 管理 Agent 的注册、注销、心跳与角色查询
// 注册时同步初始化 MessageBus 队列，确保广播可被所有已注册 Agent 接收

import { randomUUID } from 'crypto';
import type { MessageBus } from './bus.js';

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export type AgentStatus = 'idle' | 'busy' | 'offline';

export interface AgentRecord {
  id: string;
  name: string;
  role: string;
  capabilities: string[];
  status: AgentStatus;
  registeredAt: string;
  lastSeen: string;
}

// ── AgentRegistry ─────────────────────────────────────────────────────────────

export class AgentRegistry {
  private agents = new Map<string, AgentRecord>();
  private bus?: MessageBus;

  /**
   * @param bus 可选的 MessageBus 引用。
   *            提供后，每次注册 Agent 时会自动初始化其 bus 队列，
   *            确保广播（to="*"）能投递给所有已注册的 Agent。
   */
  constructor(bus?: MessageBus) {
    this.bus = bus;
  }

  /**
   * 注册一个 Agent（若 id 已存在则更新）
   */
  register(opts: {
    id?: string;
    name: string;
    role: string;
    capabilities?: string[];
    status?: AgentStatus;
  }): AgentRecord {
    const id = opts.id ?? randomUUID();
    const now = new Date().toISOString();

    const existing = this.agents.get(id);
    const record: AgentRecord = {
      id,
      name: opts.name,
      role: opts.role,
      capabilities: opts.capabilities ?? [],
      status: opts.status ?? 'idle',
      registeredAt: existing?.registeredAt ?? now,
      lastSeen: now,
    };

    this.agents.set(id, record);
    // 同步初始化 bus 队列，确保广播能投递（fix: ISSUE-002）
    this.bus?.ensureQueue(id);
    console.log(`[aether:agent-registry] ✅ Agent registered: ${id} (${record.name} / ${record.role})`);
    return record;
  }

  /**
   * 注销 Agent
   */
  unregister(id: string): boolean {
    const existed = this.agents.has(id);
    if (existed) {
      this.agents.delete(id);
      console.log(`[aether:agent-registry] ❌ Agent unregistered: ${id}`);
    }
    return existed;
  }

  /**
   * 更新心跳（lastSeen）
   */
  heartbeat(id: string, status?: AgentStatus): boolean {
    const record = this.agents.get(id);
    if (!record) return false;
    record.lastSeen = new Date().toISOString();
    if (status) record.status = status;
    return true;
  }

  /**
   * 按角色查找 Agent 列表
   */
  find(role: string): AgentRecord[] {
    return Array.from(this.agents.values()).filter((a) => a.role === role);
  }

  /**
   * 按 capability 查找
   */
  findByCapability(capability: string): AgentRecord[] {
    return Array.from(this.agents.values()).filter((a) =>
      a.capabilities.includes(capability)
    );
  }

  /**
   * 按 id 获取
   */
  get(id: string): AgentRecord | undefined {
    return this.agents.get(id);
  }

  /**
   * 列出所有 Agent
   */
  list(): AgentRecord[] {
    return Array.from(this.agents.values());
  }

  /**
   * 将超过 ttlMs 未心跳的 Agent 标记为 offline
   */
  pruneOffline(ttlMs = 60_000): number {
    const now = Date.now();
    let count = 0;
    for (const record of this.agents.values()) {
      if (record.status !== 'offline') {
        const last = new Date(record.lastSeen).getTime();
        if (now - last > ttlMs) {
          record.status = 'offline';
          count++;
        }
      }
    }
    return count;
  }
}
