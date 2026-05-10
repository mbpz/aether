// 技能路由 - EP-03 技能系统接口
import { Router, Request, Response } from 'express';

export function createSkillRouter(deps: any) {
  const router = Router();

  /**
   * GET /api/skill/list
   * 列出已注册技能（Level 1：仅元数据）
   */
  router.get('/list', (_req: Request, res: Response) => {
    // TODO: 接入技能注册表（EP-03）
    res.json({
      skills: [],
      message: 'Skill registry coming in EP-03',
    });
  });

  /**
   * GET /api/skill/:name
   * 获取技能详情（Level 2：指令层）
   */
  router.get('/:name', (req: Request, res: Response) => {
    deps.audit.log({
      action: 'skill_load',
      category: 'data_access',
      actor: { type: 'user', id: req.ip ?? 'unknown' },
      outcome: 'success',
      detail: `Loading skill: ${req.params.name} (Level 2)`,
    });
    res.json({
      name: req.params.name,
      level: 2,
      message: 'Skill loader coming in EP-03',
    });
  });

  return router;
}
