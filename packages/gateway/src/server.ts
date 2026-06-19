// Aether Gateway Server - HTTP + WebSocket
import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AuditLogger } from './audit/logger.js';
import { ManifestEngine } from './manifest/engine.js';
import { VaultInjector } from './vault/injector.js';
import { TaskQueue } from './sandbox/task-queue.js';
import { SandboxBridge } from './sandbox/bridge.js';
import { MemoryManager } from './memory/manager.js';
import { AgentRunner } from './agent-loop/runner.js';
import { AgentRegistry } from './multi-agent/registry.js';
import { MessageBus } from './multi-agent/bus.js';
import { AgentSandboxManager } from './multi-agent/sandbox-executor.js';
import { TeamOrchestrator } from './multi-agent/team-orchestrator.js';
import { LLMManager } from './llm/manager.js';
import { createAgentRouter } from './routes/agent.js';
import { createStatusRouter } from './routes/status.js';
import { createSkillRouter } from './routes/skill.js';
import { createMemoryRouter } from './routes/memory.js';
import { createAgentLoopRouter } from './routes/agent-loop.js';
import { createMultiAgentRouter } from './routes/multi-agent.js';
import { createLLMRouter } from './routes/llm.js';
import { createSkillAuditRouter } from './routes/skill-audit.js';
import { setupWsHandler } from './ws/handler.js';

interface GatewayDeps {
  audit: AuditLogger;
  manifest: ManifestEngine;
  vault: VaultInjector;
  taskQueue: TaskQueue;
  sandbox: SandboxBridge;
  memory: MemoryManager;
  agentRunner: AgentRunner;
  agentRegistry: AgentRegistry;
  messageBus: MessageBus;
  agentSandboxManager: AgentSandboxManager;
  teamOrchestrator: TeamOrchestrator;
  llmManager: LLMManager;
  config: {
    port: number;
    localToken: string;
    localTokenRequired: boolean;
    readonlyMode: boolean;
  };
}

export function createGatewayServer(deps: GatewayDeps) {
  const app = express();
  const httpServer = createServer(app);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // CORS: same-origin by default. The browser will already block
  // cross-origin reads of the bearer token, but we make it explicit by
  // never sending `Access-Control-Allow-Origin: *` together with the
  // `Authorization` header (which would also be rejected by browsers, but
  // some non-browser clients honor it).
  //
  // Operators that need cross-origin access (e.g. a UI served from a
  // different origin) must set CORS_ALLOWED_ORIGINS to a comma-separated
  // list of origins. We then echo the exact Origin back and allow the
  // Authorization header. A missing/empty env var means NO cross-origin
  // access is permitted, which is the safe default.
  const CORS_ALLOWED_ORIGINS = new Set(
    (process.env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && CORS_ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      // Only allow Authorization when the origin is explicitly trusted.
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '600');
    } else if (origin) {
      // Origin present but not in allowlist: send a static, non-wildcard
      // header that matches no real origin. This still answers preflight
      // but the browser will reject the response.
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  // 请求日志中间件
  app.use((req: Request, _res: Response, next: NextFunction) => {
    deps.audit.log({
      action: 'http_request',
      category: 'network',
      actor: { type: 'user', id: req.ip ?? 'unknown' },
      outcome: 'success',
      detail: `${req.method} ${req.path}`,
    });
    next();
  });

  // 零信任认证中间件
  app.use((req: Request, res: Response, next: NextFunction) => {
    // /health 不需要认证
    if (req.path === '/health') return next();

    if (deps.config.localTokenRequired && deps.config.localToken) {
      const authHeader = req.headers.authorization ?? '';
      const token = authHeader.replace('Bearer ', '').trim();
      if (token !== deps.config.localToken) {
        deps.audit.log({
          action: 'auth_rejected',
          category: 'authentication',
          actor: { type: 'user', id: req.ip ?? 'unknown' },
          outcome: 'failure',
          detail: `Unauthorized request to ${req.path}`,
        });
        res.status(401).json({ error: 'Unauthorized', code: 'INVALID_TOKEN' });
        return;
      }
    }
    next();
  });

  // 路由
  app.use('/api/agent', createAgentRouter(deps));
  app.use('/api/status', createStatusRouter(deps));
  app.use('/api/skill', createSkillRouter(deps));
  const skillAuditRouter = createSkillAuditRouter({ registry: deps.agentRegistry });
  app.use('/api/skill/audit', skillAuditRouter);
  app.use('/api/memory', createMemoryRouter({ memory: deps.memory }));
  app.use('/api/agent-loop', createAgentLoopRouter({ agentRunner: deps.agentRunner }));
  app.use('/api/multi-agent', createMultiAgentRouter({ registry: deps.agentRegistry, bus: deps.messageBus, sandboxManager: deps.agentSandboxManager, teamOrchestrator: deps.teamOrchestrator }));
  app.use('/api/llm', createLLMRouter({ llmManager: deps.llmManager, agentRunner: deps.agentRunner }));

  // 健康检查
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '0.1.0',
      system: 'aether-gateway',
      timestamp: new Date().toISOString(),
    });
  });

  // WebSocket 处理（Agent 双向通信）
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  setupWsHandler(wss, deps);

  // 错误处理
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[aether:gateway] Error:', err.message);
    deps.audit.log({
      action: 'server_error',
      category: 'system',
      actor: { type: 'system', id: 'internal' },
      outcome: 'failure',
      detail: err.message,
    });
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  });

  return httpServer;
}
