// EP-06: 多 Agent 协作 - HTTP 路由
// POST /api/multi-agent/register        — 注册 Agent
// POST /api/multi-agent/message         — 发送消息
// GET  /api/multi-agent/messages/:id    — 拉取消息
// GET  /api/multi-agent/agents          — 列出所有 Agent

import { Router, Request, Response } from 'express';
import type { AgentRegistry } from '../multi-agent/registry.js';
import type { MessageBus } from '../multi-agent/bus.js';

export function createMultiAgentRouter(deps: {
  registry: AgentRegistry;
  bus: MessageBus;
}) {
  const router = Router();
  const { registry, bus } = deps;

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
    res.status(201).json({ ok: true, agent: record });
  });

  /**
   * DELETE /api/multi-agent/agents/:agentId
   * 注销 Agent
   */
  router.delete('/agents/:agentId', (req: Request, res: Response) => {
    const { agentId } = req.params;
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
    });
  });

  return router;
}
