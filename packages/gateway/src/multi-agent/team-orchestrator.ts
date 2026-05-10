// EP-05: Team Orchestrator — 任务拆分 / 分发 / 汇总
// 主 Agent 调用此模块拆分任务，通过 MessageBus 分发给子 Agent，收集结果后汇总

import { randomUUID } from 'crypto';
import type { AgentRegistry } from './registry.js';
import type { MessageBus } from './bus.js';
import type { AgentSandboxManager } from './sandbox-executor.js';

// ── 类型定义 ───────────────────────────────────────────────────────────────

export type TeamRole = 'planner' | 'executor' | 'reviewer' | 'generalist';

export interface TeamMember {
  agentId: string;
  role: TeamRole;
  capabilities: string[];
}

export interface TeamTask {
  taskId: string;
  description: string;
  assignedAgent?: string;
  status: 'pending' | 'dispatched' | 'done' | 'failed';
  result?: unknown;
  error?: string;
}

export interface TeamResult {
  teamId: string;
  ok: boolean;
  originalTask: string;
  subTasks: TeamTask[];
  finalAnswer: string;
  durationMs: number;
  error?: string;
}

// ── Team Orchestrator ─────────────────────────────────────────────────────

export class TeamOrchestrator {
  private registry: AgentRegistry;
  private bus: MessageBus;
  private sandboxManager: AgentSandboxManager;
  private teams = new Map<string, TeamMember[]>();
  private teamTasks = new Map<string, TeamTask[]>();

  constructor(
    registry: AgentRegistry,
    bus: MessageBus,
    sandboxManager: AgentSandboxManager
  ) {
    this.registry = registry;
    this.bus = bus;
    this.sandboxManager = sandboxManager;
  }

  /**
   * 创建 Team 并指定成员
   */
  createTeam(name: string, members: TeamMember[]): string {
    const teamId = randomUUID();
    this.teams.set(teamId, members);

    // 向每个成员发送 team.joined 消息
    for (const member of members) {
      this.bus.publish({
        from: 'orchestrator',
        to: member.agentId,
        type: 'task',
        payload: {
          type: 'team.joined',
          teamId,
          teamName: name,
          members: members.map(m => ({ id: m.agentId, role: m.role })),
        },
      });
    }

    console.log(`[aether:team-orchestrator] Created team ${teamId} with ${members.length} members`);
    return teamId;
  }

  /**
   * 执行团队任务：拆分 → 分发 → 收集 → 汇总
   * 支持 Sequential（顺序）和 Parallel（并行）模式
   */
  async runTeamTask(
    teamId: string,
    task: string,
    mode: 'sequential' | 'parallel' = 'parallel'
  ): Promise<TeamResult> {
    const members = this.teams.get(teamId);
    if (!members || members.length === 0) {
      return { teamId, ok: false, originalTask: task, subTasks: [], finalAnswer: '', durationMs: 0, error: 'Team not found or has no members' };
    }

    const startTime = Date.now();
    const taskId = randomUUID();
    const subTasks = this._splitTask(task, members);

    for (const st of subTasks) {
      st.status = 'dispatched';
    }
    this.teamTasks.set(taskId, subTasks);

    if (mode === 'parallel') {
      // 并行分发：向所有子 Agent 同时发送任务
      await Promise.all(subTasks.map(st => this._dispatchToAgent(st, members)));
    } else {
      // 顺序分发：等待每个完成再发下一个
      for (const st of subTasks) {
        await this._dispatchToAgent(st, members);
      }
    }

    // 汇总结果
    const finalAnswer = this._aggregateResults(subTasks);
    return {
      teamId,
      ok: subTasks.every(st => st.status === 'done'),
      originalTask: task,
      subTasks,
      finalAnswer,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * 快速执行：创建临时团队，执行完毕后解散
   * 适用于一次性任务，无需持久化团队
   */
  async runQuickTeam(
    task: string,
    agentIds: string[],
    roleMap?: Record<string, TeamRole>
  ): Promise<TeamResult> {
    const members = agentIds.map((id, i) => ({
      agentId: id,
      role: roleMap?.[id] ?? 'generalist',
      capabilities: [] as string[],
    }));

    const teamId = this.createTeam('quick-team', members);
    const result = await this.runTeamTask(teamId, task, 'parallel');
    this.disbandTeam(teamId);
    return result;
  }

  /**
   * 解散团队
   */
  disbandTeam(teamId: string): void {
    const members = this.teams.get(teamId);
    if (members) {
      for (const member of members) {
        this.bus.publish({
          from: 'orchestrator',
          to: member.agentId,
          type: 'task',
          payload: { type: 'team.disbanded', teamId },
        });
        this.bus.endSession(member.agentId);
        this.sandboxManager.dispose(member.agentId);
      }
    }
    this.teams.delete(teamId);
    console.log(`[aether:team-orchestrator] Team ${teamId} disbanded`);
  }

  /**
   * 任务拆分：根据成员数量和能力将大任务拆分为子任务
   * 简化版：平均分配 description 内容
   */
  private _splitTask(task: string, members: TeamMember[]): TeamTask[] {
    return members.map(member => ({
      taskId: randomUUID(),
      description: task,
      assignedAgent: member.agentId,
      status: 'pending' as const,
    }));
  }

  /**
   * 通过 MessageBus 向指定 Agent 分发任务
   */
  private async _dispatchToAgent(task: TeamTask, members: TeamMember[]): Promise<void> {
    if (!task.assignedAgent) return;

    const member = members.find(m => m.agentId === task.assignedAgent);
    const roleHint = member?.role ?? 'generalist';

    this.bus.publish({
      from: 'orchestrator',
      to: task.assignedAgent,
      type: 'task',
      payload: {
        type: 'team.task',
        taskId: task.taskId,
        description: task.description,
        roleHint,
      },
    });

    // 等待 result 消息（最多 60s 超时）
    await this._waitForResult(task);
  }

  /**
   * 等待指定 taskId 的结果（轮询 MessageBus）
   */
  private _waitForResult(task: TeamTask): Promise<void> {
    return new Promise((resolve) => {
      const maxWaitMs = 60_000;
      const pollInterval = 200;
      const deadline = Date.now() + maxWaitMs;

      const poll = () => {
        const messages = this.bus.consume('orchestrator', 10);
        const resultMsg = messages.find(
          m => m.type === 'result' &&
            typeof m.payload === 'object' &&
            (m.payload as any).taskId === task.taskId
        );

        if (resultMsg) {
          const p = resultMsg.payload as any;
          if (p.ok) {
            task.status = 'done';
            task.result = p.result;
          } else {
            task.status = 'failed';
            task.error = p.error;
          }
          resolve();
          return;
        }

        if (Date.now() > deadline) {
          task.status = 'failed';
          task.error = 'Timeout waiting for result';
          resolve();
          return;
        }

        setTimeout(poll, pollInterval);
      };

      setTimeout(poll, pollInterval);
    });
  }

  /**
   * 汇总所有子任务结果为最终答案
   */
  private _aggregateResults(subTasks: TeamTask[]): string {
    const done = subTasks.filter(st => st.status === 'done');
    if (done.length === 0) return 'No subtasks completed successfully.';

    if (done.length === 1) {
      return `Result: ${JSON.stringify(done[0].result ?? done[0])}`;
    }

    const results = done.map((st, i) => `[${i + 1}] Agent ${st.assignedAgent}: ${JSON.stringify(st.result)}`).join('\n');
    return `Aggregated results from ${done.length}/${subTasks.length} agents:\n${results}`;
  }
}
