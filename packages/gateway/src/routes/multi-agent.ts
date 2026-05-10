// EP-05: 多 Agent 协作 - HTTP 路由
// POST /api/multi-agent/register        — 注册 Agent
// POST /api/multi-agent/message         — 发送消息
// GET  /api/multi-agent/messages/:id    — 拉取消息
// GET  /api/multi-agent/agents          — 列出所有 Agent
// POST /api/multi-agent/team/run        — 快速团队执行
// POST /api/multi-agent/team/create     — 创建持久团队
// POST /api/multi-agent/team/:id/run    — 团队任务执行
// DELETE /api/multi-agent/team/:id      — 解散团队
// POST /api/multi-agent/sandbox/execute — Per-agent 独立沙箱执行
// DELETE /api/multi-agent/sandbox/:id   — 释放沙箱
// GET  /api/multi-agent/sandbox/stats  — 沙箱状态

import { Router, Request, Response } from 'express';
import type { AgentRegistry } from '../multi-agent/registry.js';
import type { MessageBus } from '../multi-agent/bus.js';
import type { AgentSandboxManager } from '../multi-agent/sandbox-executor.js';
import type { TeamOrchestrator } from '../multi-agent/team-orchestrator.js';

export function createMultiAgentRouter(deps: {
  registry: AgentRegistry;
  bus: MessageBus;
  sandboxManager: AgentSandboxManager;
  teamOrchestrator: TeamOrchestrator;
}) {
  const router = Router();
  const { registry, bus, sandboxManager, teamOrchestrator } = deps;

  /**
   * POST /api/multi-agent/register
   * Body: { name, role, capabilities?, status?, id? }
   */
  router.post('/register', (req: Request, res: Response) => {
    const { name, role, capabilities, status, id } = req.body as {
      name?: string;
      role?: string;
      capabilities?: string[];
      status?: 'idle' | 'busy' | 'offline';
      id?: string;
    };

    if (!name || !role) {
      res.status(400).json({
        error: 'Bad Request',
        message: '"name" and "role" are required',
      });
      return;
    }

    const record = registry.register({ id, name, role, capabilities, status });

    // EP-05: 为新 Agent 创建加密会话密钥
    const keyId = bus.createSession(record.id);

    // EP-05: 初始化该 Agent 的独立沙箱
    sandboxManager.getOrCreate(record.id);

    res.status(201).json({ ok: true, agent: record, keyId });
  });

  /**
   * DELETE /api/multi-agent/agents/:agentId
   * 注销 Agent
   */
  router.delete('/agents/:agentId', (req: Request, res: Response) => {
    const { agentId } = req.params;
    bus.endSession(agentId);
    sandboxManager.dispose(agentId);
    const removed = registry.unregister(agentId);
    if (!removed) {
      res.status(404).json({ error: 'Agent not found', agentId });
      return;
    }
    res.json({ ok: true, agentId });
  });

  /**
   * POST /api/multi-agent/agents/:agentId/heartbeat
   * Body: { status? }
   */
  router.post('/agents/:agentId/heartbeat', (req: Request, res: Response) => {
    const { agentId } = req.params;
    const { status } = req.body as { status?: 'idle' | 'busy' | 'offline' };
    const ok = registry.heartbeat(agentId, status);
    if (!ok) {
      res.status(404).json({ error: 'Agent not found', agentId });
      return;
    }
    res.json({ ok: true, agentId, lastSeen: new Date().toISOString() });
  });

  /**
   * GET /api/multi-agent/agents
   * 列出所有 Agent（支持 ?role= 过滤）
   */
  router.get('/agents', (req: Request, res: Response) => {
    const { role } = req.query as { role?: string };
    const agents = role ? registry.find(role) : registry.list();
    res.json({ agents, total: agents.length });
  });

  /**
   * POST /api/multi-agent/message
   * Body: { from, to, type, payload }
   */
  router.post('/message', (req: Request, res: Response) => {
    const { from, to, type, payload } = req.body as {
      from?: string;
      to?: string;
      type?: string;
      payload?: unknown;
    };

    if (!from || !to || !type) {
      res.status(400).json({
        error: 'Bad Request',
        message: '"from", "to", and "type" are required',
      });
      return;
    }

    const validTypes = ['task', 'result', 'issue', 'heartbeat'];
    if (!validTypes.includes(type)) {
      res.status(400).json({
        error: 'Bad Request',
        message: `"type" must be one of: ${validTypes.join(', ')}`,
      });
      return;
    }

    const msg = bus.publish({
      from,
      to,
      type: type as 'task' | 'result' | 'issue' | 'heartbeat',
      payload: payload ?? null,
    });
    res.status(201).json({ ok: true, message: msg });
  });

  /**
   * GET /api/multi-agent/messages/:agentId
   * 拉取（并消费）指定 Agent 的待处理消息
   * Query: ?limit=50&peek=false
   */
  router.get('/messages/:agentId', (req: Request, res: Response) => {
    const { agentId } = req.params;
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 200);
    const peek = req.query.peek === 'true';

    const messages = peek
      ? bus.peek(agentId, limit)
      : bus.consume(agentId, limit);

    res.json({ agentId, messages, total: messages.length });
  });

  /**
   * GET /api/multi-agent/history
   * 查看消息总线历史（JSONL 持久化内容）
   */
  router.get('/history', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10), 500);
    const history = bus.loadHistory(limit);
    res.json({ messages: history, total: history.length });
  });

  /**
   * GET /api/multi-agent/stats
   */
  router.get('/stats', (_req: Request, res: Response) => {
    res.json({
      bus: bus.stats(),
      registry: {
        total: registry.list().length,
        byStatus: registry.list().reduce<Record<string, number>>((acc, a) => {
          acc[a.status] = (acc[a.status] ?? 0) + 1;
          return acc;
        }, {}),
      },
      sandbox: sandboxManager.stats(),
    });
  });

  /**
   * POST /api/multi-agent/sandbox/execute
   * 在指定 Agent 的独立沙箱中执行代码
   */
  router.post('/sandbox/execute', async (req: Request, res: Response) => {
    const { agentId, code, input, timeout } = req.body as {
      agentId?: string;
      code?: string;
      input?: unknown;
      timeout?: number;
    };

    if (!agentId || !code) {
      res.status(400).json({ error: 'agentId and code are required' });
      return;
    }

    const executor = sandboxManager.getOrCreate(agentId);
    const result = await executor.execute(code, { timeout, input });
    res.json({ agentId, result });
  });

  /**
   * DELETE /api/multi-agent/sandbox/:agentId
   * 释放指定 Agent 的沙箱实例
   */
  router.delete('/sandbox/:agentId', (req: Request, res: Response) => {
    const { agentId } = req.params;
    sandboxManager.dispose(agentId);
    res.json({ ok: true, agentId });
  });

  /**
   * POST /api/multi-agent/team/run
   * 创建临时团队并执行任务（快速路径）
   * Body: { task: string; agentIds: string[]; roleMap?: Record<string, TeamRole>; mode?: 'sequential' | 'parallel' }
   */
  router.post('/team/run', async (req: Request, res: Response) => {
    const { task, agentIds, roleMap, mode } = req.body as {
      task?: string;
      agentIds?: string[];
      roleMap?: Record<string, string>;
      mode?: 'sequential' | 'parallel';
    };

    if (!task || !Array.isArray(agentIds) || agentIds.length === 0) {
      res.status(400).json({ error: 'task and agentIds[] are required' });
      return;
    }

    if (agentIds.length > 10) {
      res.status(400).json({ error: 'Maximum 10 agents per team' });
      return;
    }

    // 验证所有 agentId 都已注册
    const validAgents = agentIds.filter(id => registry.get(id));
    if (validAgents.length !== agentIds.length) {
      res.status(400).json({ error: 'Some agentIds are not registered', invalid: agentIds.filter(id => !registry.get(id)) });
      return;
    }

    const result = await teamOrchestrator.runQuickTeam(
      task,
      agentIds,
      roleMap as Record<string, import('../multi-agent/team-orchestrator.js').TeamRole>
    );
    res.json({ ok: result.ok, result });
  });

  /**
   * POST /api/multi-agent/team/create
   * 创建持久团队（可多次使用）
   * Body: { name: string; members: Array<{ agentId: string; role: TeamRole; capabilities?: string[] }> }
   */
  router.post('/team/create', (req: Request, res: Response) => {
    const { name, members } = req.body as {
      name?: string;
      members?: Array<{ agentId: string; role: string; capabilities?: string[] }>;
    };

    if (!name || !Array.isArray(members) || members.length === 0) {
      res.status(400).json({ error: 'name and members[] are required' });
      return;
    }

    const teamId = teamOrchestrator.createTeam(name, members as import('../multi-agent/team-orchestrator.js').TeamMember[]);
    res.status(201).json({ ok: true, teamId, memberCount: members.length });
  });

  /**
   * POST /api/multi-agent/team/:teamId/run
   * 使用已创建团队执行任务
   */
  router.post('/team/:teamId/run', async (req: Request, res: Response) => {
    const { teamId } = req.params;
    const { task, mode } = req.body as { task?: string; mode?: 'sequential' | 'parallel' };

    if (!task) {
      res.status(400).json({ error: 'task is required' });
      return;
    }

    const result = await teamOrchestrator.runTeamTask(teamId, task, mode ?? 'parallel');
    res.json({ ok: result.ok, result });
  });

  /**
   * DELETE /api/multi-agent/team/:teamId
   * 解散团队
   */
  router.delete('/team/:teamId', (req: Request, res: Response) => {
    const { teamId } = req.params;
    teamOrchestrator.disbandTeam(teamId);
    res.json({ ok: true, teamId });
  });

  return router;
}
