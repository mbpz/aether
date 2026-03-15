// EP-07: LLM REST 路由
// POST /api/llm/configure  — 配置 provider
// GET  /api/llm/config     — 查看当前配置（不含 apiKey）
// POST /api/llm/ping       — 测试连通性
// POST /api/llm/chat       — 直接对话（不走 Agent Loop）
// GET  /api/llm/presets    — 获取预设列表
// POST /api/llm/run        — 用 LLM Planner 执行 Agent 任务

import { Router, Request, Response } from 'express';
import { LLMManager } from '../llm/manager.js';
import { LLMPlanner } from '../llm/planner.js';
import { AgentRunner } from '../agent-loop/runner.js';

interface LLMRouterDeps {
  llmManager: LLMManager;
  agentRunner: AgentRunner;
}

export function createLLMRouter(deps: LLMRouterDeps): Router {
  const router = Router();
  const { llmManager, agentRunner } = deps;

  // ── GET /presets ──────────────────────────────────────────────────────────
  router.get('/presets', (_req: Request, res: Response) => {
    res.json({ presets: llmManager.presets() });
  });

  // ── GET /config ───────────────────────────────────────────────────────────
  router.get('/config', (_req: Request, res: Response) => {
    const config = llmManager.safeConfig();
    res.json({
      configured: llmManager.isConfigured,
      config,
    });
  });

  // ── POST /configure ───────────────────────────────────────────────────────
  router.post('/configure', (req: Request, res: Response) => {
    const { type, baseUrl, apiKey, model, timeoutMs, temperature, maxTokens } = req.body ?? {};

    if (!baseUrl || !model) {
      res.status(400).json({ error: 'baseUrl and model are required' });
      return;
    }

    try {
      llmManager.configure({
        type: type ?? 'custom',
        baseUrl,
        apiKey,
        model,
        timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
        temperature: temperature !== undefined ? Number(temperature) : undefined,
        maxTokens: maxTokens ? Number(maxTokens) : undefined,
      });
      res.json({ ok: true, config: llmManager.safeConfig() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── POST /ping ────────────────────────────────────────────────────────────
  router.post('/ping', async (_req: Request, res: Response) => {
    const result = await llmManager.ping();
    res.json(result);
  });

  // ── POST /chat ────────────────────────────────────────────────────────────
  // 直接多轮对话，不走 Agent Loop，不调用工具
  router.post('/chat', async (req: Request, res: Response) => {
    if (!llmManager.isConfigured) {
      res.status(503).json({ error: 'LLM provider not configured. Call POST /api/llm/configure first.' });
      return;
    }

    const { messages, temperature, maxTokens } = req.body ?? {};

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages array is required' });
      return;
    }

    const t0 = Date.now();
    try {
      const resp = await llmManager.provider!.chat(messages, {
        temperature: temperature !== undefined ? Number(temperature) : undefined,
        maxTokens: maxTokens ? Number(maxTokens) : undefined,
      });
      res.json({
        ok: true,
        message: resp.choices?.[0]?.message ?? null,
        model: resp.model,
        usage: resp.usage,
        durationMs: Date.now() - t0,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
      });
    }
  });

  // ── POST /run ─────────────────────────────────────────────────────────────
  // 使用 LLM Planner 执行 Agent 任务（真实 ReAct 循环）
  router.post('/run', async (req: Request, res: Response) => {
    if (!llmManager.isConfigured) {
      res.status(503).json({ error: 'LLM provider not configured. Call POST /api/llm/configure first.' });
      return;
    }

    const { task, sessionId } = req.body ?? {};
    if (!task) {
      res.status(400).json({ error: 'task is required' });
      return;
    }

    const t0 = Date.now();
    try {
      // 复用 AgentRunner 已注册的工具，驱动 LLMPlanner 执行 ReAct 循环
      const registry = agentRunner.getRegistry();
      const planner = new LLMPlanner(llmManager.provider!, registry);
      const plannerResult = await planner.plan(String(task));

      res.json({
        ok: plannerResult.ok,
        sessionId: sessionId ?? `llm-${Date.now()}`,
        answer: plannerResult.answer,
        steps: plannerResult.steps,
        durationMs: Date.now() - t0,
        planner: 'llm',
        model: llmManager.provider!.model,
        error: plannerResult.error,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
      });
    }
  });

  return router;
}
