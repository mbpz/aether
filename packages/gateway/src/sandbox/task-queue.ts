// TaskQueue - 沙箱任务生命周期管理
// 追踪每个执行请求的状态：queued → running → done / failed

import { EventEmitter } from 'events';

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'rejected';

export interface SandboxTask {
  id: string;
  status: TaskStatus;
  operation: string;
  code?: string;
  input?: unknown;
  injectedSecrets: string[];
  manifestName?: string;
  submittedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: {
    ok: boolean;
    output?: unknown;
    stdout?: string;
    stderr?: string;
    error?: string;
    durationMs?: number;
    memoryUsedMb?: number;
    violations?: Array<{ type: string; detail: string }>;
  };
  source: string;
  /** EP-05: Agent ID for per-agent sandbox isolation */
  agentId?: string;
}

export class TaskQueue extends EventEmitter {
  private tasks: Map<string, SandboxTask> = new Map();
  private readonly MAX_HISTORY = 200; // 最多保留 200 条历史

  enqueue(task: Omit<SandboxTask, 'status' | 'submittedAt'>): SandboxTask {
    const fullTask: SandboxTask = {
      ...task,
      status: 'queued',
      submittedAt: new Date().toISOString(),
    };
    this.tasks.set(fullTask.id, fullTask);
    this.emit('enqueue', fullTask);
    this._trim();
    return fullTask;
  }

  markRunning(id: string) {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    this.emit('running', task);
  }

  markDone(id: string, result: SandboxTask['result']) {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = result?.ok ? 'done' : 'failed';
    task.result = result;
    task.completedAt = new Date().toISOString();
    this.emit('done', task);
  }

  markRejected(id: string, reason: string) {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'rejected';
    task.result = { ok: false, error: reason };
    task.completedAt = new Date().toISOString();
    this.emit('rejected', task);
  }

  get(id: string): SandboxTask | undefined {
    return this.tasks.get(id);
  }

  list(limit = 50): SandboxTask[] {
    return Array.from(this.tasks.values())
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .slice(0, limit);
  }

  stats() {
    const all = Array.from(this.tasks.values());
    return {
      total: all.length,
      queued: all.filter(t => t.status === 'queued').length,
      running: all.filter(t => t.status === 'running').length,
      done: all.filter(t => t.status === 'done').length,
      failed: all.filter(t => t.status === 'failed').length,
      rejected: all.filter(t => t.status === 'rejected').length,
    };
  }

  private _trim() {
    if (this.tasks.size <= this.MAX_HISTORY) return;
    // 删除最旧的已完成任务
    const completed = Array.from(this.tasks.entries())
      .filter(([, t]) => ['done', 'failed', 'rejected'].includes(t.status))
      .sort(([, a], [, b]) => a.submittedAt.localeCompare(b.submittedAt));
    const toDelete = completed.slice(0, this.tasks.size - this.MAX_HISTORY);
    toDelete.forEach(([id]) => this.tasks.delete(id));
  }
}
