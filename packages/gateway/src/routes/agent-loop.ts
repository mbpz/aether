// EP-05: Agent Loop - HTTP 路由
// POST /api/agent-loop/run  — 提交 Agent 任务，同步返回结果
// GET  /api/agent-loop/sessions — 列出历史 session

import { Router, Request, Response } from 'express';
import { AgentRunner } from '../agent-loop/runner.js';

export function createAgentLoopRouter(deps: {
  agentRunner: AgentRunner;
}) {
  const router = Router();
  const { agentRunner } = deps;

  /**
   * POST /api/agent-loop/run
   * Body: { task: string; sessionId?: string }
   * 同步执行 Agent 任务，返回完整运行结果
   */
  router.post('/run', async (req: Request, res: Response) => {
    const { task, sessionId } = req.body as { task?: string; sessionId?: string };

    if (!task || typeof task !== 'string' || !task.trim()) {
      res.status(400).json({
        error: 'Bad Request',
        message: '"task" field is required and must be a non-empty string',
      });
      return;
    }

    try {
      const result = await agentRunner.run(task.trim(), sessionId);
      const statusCode = result.ok ? 200 : 422;
      res.status(statusCode).json(result);
    } catch (err) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /**
   * GET /api/agent-loop/sessions
   * Query: ?limit=20
   * 列出历史 session 摘要
   */
  router.get('/sessions', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10), 100);
    const sessions = agentRunner.listSessions(limit);
    res.json({ sessions, total: sessions.length });
  });

  /**
   * GET /api/agent-loop/sessions/:sessionId
   * 获取指定 session 的摘要
   */
  router.get('/sessions/:sessionId', (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const session = agentRunner.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found', sessionId });
      return;
    }
    res.json(session);
  });

  return router;
}
