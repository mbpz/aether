// 系统状态路由
import { Router, Request, Response } from 'express';
import { readFileSync, existsSync } from 'fs';

export function createStatusRouter(deps: any) {
  const router = Router();

  /**
   * GET /api/status
   * 获取 Gateway 整体状态
   */
  router.get('/', (_req: Request, res: Response) => {
    res.json({
      system: 'aether-gateway',
      version: '0.1.0',
      status: 'running',
      config: {
        readonlyMode: deps.config.readonlyMode,
        localTokenRequired: deps.config.localTokenRequired,
        port: deps.config.port,
      },
      manifests: deps.manifest.listManifests(),
      vault: deps.vault.stats(),
      sandbox: deps.taskQueue ? deps.taskQueue.stats() : null,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/status/audit
   * 获取最近审计日志
   */
  router.get('/audit', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string ?? '50', 10);
    const recent = deps.audit.recent(limit);
    const logPath = deps.audit.todayLogPath();

    res.json({
      recent,
      logPath,
      count: recent.length,
    });
  });

  /**
   * GET /api/status/audit/today
   * 获取今天的完整审计日志文件内容
   */
  router.get('/audit/today', (_req: Request, res: Response) => {
    const logPath = deps.audit.todayLogPath();
    if (!existsSync(logPath)) {
      res.json({ entries: [], logPath, message: 'No audit log for today yet' });
      return;
    }
    const raw = readFileSync(logPath, 'utf-8');
    const entries = raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); }
        catch { return null; }
      })
      .filter(Boolean);

    res.json({ entries, logPath, count: entries.length });
  });

  return router;
}
