// Agent 执行路由 - 接收 Agent 任务请求，经 Manifest 审计后转发到沙箱
import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';

export function createAgentRouter(deps: any) {
  const router = Router();

  /**
   * POST /api/agent/execute
   * 提交一个 Agent 执行请求（同步模式：等待执行结果）
   */
  router.post('/execute', async (req: Request, res: Response) => {
    const {
      code,
      operation = 'exec',
      target,
      manifestName,
      secretIds = [],
      input,
      sync = true,         // 默认同步等待结果
    } = req.body;

    if (!code && operation === 'exec') {
      res.status(400).json({ error: 'code is required for exec operation' });
      return;
    }

    const requestId = randomUUID();

    // ── Manifest 审计 ──
    const validation = deps.manifest.validate({ operation, target, manifestName });

    deps.audit.log({
      action: 'agent_execute_request',
      source: req.ip ?? 'unknown',
      ok: validation.allowed,
      detail: validation.allowed
        ? `Request ${requestId} passed manifest validation`
        : `Request ${requestId} REJECTED: ${validation.reason}`,
      metadata: { requestId, operation, target, manifestName },
    });

    if (!validation.allowed) {
      res.status(403).json({
        error: 'Manifest Violation',
        reason: validation.reason,
        requestId,
        code: 'MANIFEST_REJECTED',
      });
      return;
    }

    // 只读模式：拒绝写操作
    if (deps.config.readonlyMode && operation !== 'read' && operation !== 'exec') {
      res.status(403).json({
        error: 'Readonly Mode',
        reason: 'System is in readonly mode.',
        requestId,
        code: 'READONLY_MODE',
      });
      return;
    }

    // ── Vault 凭证注入 ──
    const injectedEnv = deps.vault.resolveAsEnv(secretIds, requestId);

    // ── 提交到沙箱执行 ──
    if (sync) {
      // 同步模式：等待执行完成，返回结果
      try {
        const task = await deps.sandbox.executeSync({
          id: requestId,
          code,
          operation,
          input,
          env: injectedEnv,
          injectedSecrets: Object.keys(injectedEnv),
          manifestName: validation.manifest?.name,
          source: req.ip ?? 'unknown',
          timeout: 30_000,
        });

        // 自动写入记忆（L1 + L3）
        if (deps.memory && task.result) {
          const memContent = [
            `[exec] ${new Date().toISOString()}`,
            `Code: ${code.slice(0, 300)}${code.length > 300 ? '...' : ''}`,
            `OK: ${task.result.ok}`,
            task.result.stdout ? `stdout: ${task.result.stdout.slice(0, 200)}` : '',
            task.result.error  ? `error: ${task.result.error}` : '',
          ].filter(Boolean).join('\n');

          deps.memory.remember(memContent, {
            source: 'exec',
            taskId: requestId,
            importance: task.result.ok ? 0.6 : 0.8,  // 失败记忆更重要
            tags: ['exec', operation, task.result.ok ? 'success' : 'failure'],
          }, ['working', 'semantic']);
        }

        const statusCode = task.result?.ok ? 200 : 422;
        res.status(statusCode).json({
          requestId,
          status: task.status,
          operation,
          result: task.result,
          manifestName: task.manifestName,
          durationMs: task.result?.durationMs,
          completedAt: task.completedAt,
        });
      } catch (err) {
        res.status(500).json({
          requestId,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      // 异步模式：立即返回 taskId，稍后轮询
      const task = deps.sandbox.submit({
        id: requestId,
        code,
        operation,
        input,
        env: injectedEnv,
        injectedSecrets: Object.keys(injectedEnv),
        manifestName: validation.manifest?.name,
        source: req.ip ?? 'unknown',
      });

      res.status(202).json({
        requestId,
        status: task.status,
        message: 'Task accepted and queued for sandbox execution',
        pollUrl: `/api/agent/tasks/${requestId}`,
      });
    }
  });

  /**
   * GET /api/agent/tasks/:taskId
   * 查询任务执行状态和结果
   */
  router.get('/tasks/:taskId', (req: Request, res: Response) => {
    const { taskId } = req.params;
    const task = deps.taskQueue.get(taskId);

    if (!task) {
      res.status(404).json({ error: 'Task not found', taskId });
      return;
    }

    res.json({
      taskId,
      status: task.status,
      operation: task.operation,
      result: task.result,
      submittedAt: task.submittedAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    });
  });

  /**
   * GET /api/agent/tasks
   * 列出最近的任务
   */
  router.get('/tasks', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(String(req.query.limit ?? '20')), 100);
    const tasks = deps.taskQueue.list(limit);
    res.json({
      tasks,
      stats: deps.taskQueue.stats(),
    });
  });

  /**
   * GET /api/agent/sandbox/stats
   * 沙箱统计信息
   */
  router.get('/sandbox/stats', (_req: Request, res: Response) => {
    res.json({
      queue: deps.taskQueue.stats(),
      policy: deps.sandbox.policyStats(),
    });
  });

  return router;
}
