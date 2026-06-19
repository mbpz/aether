// EP-04: 记忆系统 API 路由
// POST /api/memory/remember   写入记忆
// POST /api/memory/recall     检索记忆
// DELETE /api/memory/:id      删除记忆
// GET  /api/memory/stats      统计信息
// POST /api/memory/clear      清空工作记忆

import { Router, Request, Response } from 'express';
import type { MemoryManager } from '../memory/manager.js';
import type { MemoryTier, MemoryQuery } from '../memory/types.js';

interface MemoryDeps {
  memory: MemoryManager;
}

export function createMemoryRouter(deps: MemoryDeps): Router {
  const router = Router();

  // ── POST /remember ────────────────────────────────────────────────────────
  router.post('/remember', (req: Request, res: Response) => {
    const { content, metadata, tiers } = req.body as {
      content: string;
      metadata?: Record<string, unknown>;
      tiers?: MemoryTier[];
    };

    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: 'content is required and must be a string' });
      return;
    }
    if (content.length > 10000) {
      res.status(400).json({ error: 'content exceeds 10000 character limit' });
      return;
    }

    try {
      const entry = deps.memory.remember(content, metadata as MemoryEntry['metadata'], tiers);
      res.json({ ok: true, entry });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // ── POST /recall ──────────────────────────────────────────────────────────
  router.post('/recall', (req: Request, res: Response) => {
    const query = req.body as MemoryQuery;

    if (!query || typeof query !== 'object') {
      res.status(400).json({ error: 'Request body must be a query object' });
      return;
    }

    try {
      const result = deps.memory.recall(query);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // ── GET /stats ────────────────────────────────────────────────────────────
  router.get('/stats', (_req: Request, res: Response) => {
    const stats = deps.memory.stats();
    res.json({ ok: true, stats });
  });

  // ── DELETE /:id ───────────────────────────────────────────────────────────
  router.delete('/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const removed = await deps.memory.forget(id);
    if (removed) {
      res.json({ ok: true, message: `Memory ${id} removed` });
    } else {
      res.status(404).json({ ok: false, error: 'Memory not found' });
    }
  });

  // ── POST /clear ────────────────────────────────────────────────────────────
  router.post('/clear', (req: Request, res: Response) => {
    const { tier } = req.body as { tier?: MemoryTier };
    if (!tier || tier === 'working') {
      deps.memory.clearWorking();
    }
    res.json({ ok: true, message: `Cleared ${tier ?? 'working'} memory` });
  });

  return router;
}

// 补充类型引用（避免独立导入）
import type { MemoryEntry } from '../memory/types.js';
