// 系统状态路由
import { Router, Request, Response, NextFunction } from 'express';
import { readFileSync, existsSync } from 'fs';

// Sentinel token used for the auditor role. Compared with constant-time
// equality so timing side-channels don't leak whether a prefix matched.
//
// Env resolution happens once at module load; if the operator did not set
// one, the audit endpoints will refuse ALL requests (fail-closed).
import { timingSafeEqual } from 'crypto';

const ADMIN_TOKEN = process.env.LOCAL_API_TOKEN ?? '';
const AUDITOR_TOKEN = process.env.AUDIT_READ_TOKEN ?? '';

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Require a specific role token. The token is supplied via the
 * `X-Aether-Role: <role>` header alongside the standard bearer token.
 * Roles supported:
 *   - `admin`  — `LOCAL_API_TOKEN` (the main admin token)
 *   - `auditor` — `AUDIT_READ_TOKEN` (separate, read-only)
 */
function requireRole(role: 'admin' | 'auditor') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = String(req.headers['x-aether-role-token'] ?? '');
    const expected = role === 'admin' ? ADMIN_TOKEN : AUDITOR_TOKEN;
    if (!expected || !provided || !constantTimeEquals(provided, expected)) {
      res.status(401).json({ error: 'Unauthorized', code: 'ROLE_TOKEN_REQUIRED', role });
      return;
    }
    next();
  };
}

export function createStatusRouter(deps: any) {
  const router = Router();

  // Per-IP rate limiter for the public /api/status endpoint. Prevents an
  // unauthenticated attacker from scraping status/manifests to fingerprint
  // the deployment or to use the endpoint as a timing oracle.
  const WINDOW_MS = 60_000;
  const MAX_PER_WINDOW = 30;
  const statusHits = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of statusHits) {
      if (bucket.resetAt <= now) statusHits.delete(ip);
    }
  }, WINDOW_MS).unref();

  function rateLimitStatus(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    let bucket = statusHits.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      statusHits.set(ip, bucket);
    }
    bucket.count++;
    res.setHeader('X-RateLimit-Limit', String(MAX_PER_WINDOW));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, MAX_PER_WINDOW - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > MAX_PER_WINDOW) {
      res.status(429).json({ error: 'Too Many Requests', code: 'RATE_LIMITED' });
      return;
    }
    next();
  }

  /**
   * GET /api/status
   * 获取 Gateway 整体状态（公开，敏感字段脱敏）
   *
   * Surface area is intentionally minimal:
   *   - no manifest names (could be used to fingerprint the deployment)
   *   - no internal port / auth-required flag
   *   - vault summary is a single number
   */
  router.get('/', rateLimitStatus, (_req: Request, res: Response) => {
    res.json({
      system: 'aether-gateway',
      version: '0.1.0',
      status: 'running',
      config: {
        // Only the bits the operator already advertised in deployment docs.
        readonlyMode: !!deps.config.readonlyMode,
        auditorTokenConfigured: AUDITOR_TOKEN.length > 0,
      },
      vault: {
        activeSecrets: deps.vault?.stats?.()?.activeSecrets ?? 0,
      },
      sandbox: deps.taskQueue ? deps.taskQueue.stats() : null,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/status/audit
   * 获取最近审计日志（需 auditor 角色）
   */
  router.get('/audit', requireRole('auditor'), (req: Request, res: Response) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string ?? '50', 10) || 50, 1), 500);
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
   * 获取今天的完整审计日志文件内容（需 auditor 角色）
   */
  router.get('/audit/today', requireRole('auditor'), (_req: Request, res: Response) => {
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
