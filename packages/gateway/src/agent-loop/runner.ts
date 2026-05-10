// EP-05: Agent Loop - Agent Runner
// 执行 ReAct 循环，持久化步骤到记忆，返回完整运行结果

import { randomUUID } from 'crypto';
import type { MemoryManager } from '../memory/manager.js';
import type { SandboxBridge } from '../sandbox/bridge.js';
import type { LLMProvider } from '../llm/provider.js';
import { ToolRegistry, createBuiltinTools } from './tools.js';
import { MockPlanner } from './planner.js';
import type { AgentStep } from './planner.js';
import { LLMPlanner } from '../llm/planner.js';

// ── 对外导出的类型 ─────────────────────────────────────────────────────────────

export type { AgentStep };

export interface AgentRunResult {
  ok: boolean;
  sessionId: string;
  answer: string;
  steps: AgentStep[];
  durationMs: number;
  tokensUsed?: number;
  error?: string;
}

// ── Session 历史记录 ──────────────────────────────────────────────────────────

export interface SessionRecord {
  sessionId: string;
  task: string;
  startedAt: string;
  completedAt?: string;
  ok: boolean;
  answer: string;
  stepCount: number;
  durationMs: number;
}

// ── AgentRunner ───────────────────────────────────────────────────────────────

export class AgentRunner {
  private registry: ToolRegistry;
  private planner: MockPlanner | LLMPlanner;
  private sessions: Map<string, SessionRecord> = new Map();
  private memory?: MemoryManager;
  private sandbox?: SandboxBridge;

  constructor(opts: {
    memory?: MemoryManager;
    sandbox?: SandboxBridge;
    llm?: LLMProvider;
    maxSteps?: number;
  } = {}) {
    this.memory = opts.memory;
    this.sandbox = opts.sandbox;

    this.registry = new ToolRegistry();

    // 注册内置工具
    const builtins = createBuiltinTools({
      execCode: this.sandbox
        ? async (code: string) => {
            const result = await this.sandbox!.executeSync({
              id: randomUUID(),
              code,
              operation: 'exec',
              injectedSecrets: [],
              source: 'agent-loop',
              timeout: 15_000,
            });
            return result.result ?? { ok: false, error: 'No result' };
          }
        : undefined,

      rememberFn: this.memory
        ? (content: string, meta?: Record<string, unknown>) =>
            this.memory!.remember(content, { source: 'agent-loop', ...meta }, ['working'])
        : undefined,

      recallFn: this.memory
        ? (query: string, limit = 5) =>
            this.memory!.recall({ text: query, limit })
        : undefined,

      getStatusFn: () => ({
        status: 'ok',
        system: 'aether-gateway',
        timestamp: new Date().toISOString(),
        memory: this.memory?.stats(),
      }),
    });

    for (const tool of builtins) {
      this.registry.register(tool);
    }

    // 使用 LLMPlanner（真实 LLM）如果提供了 llm，否则回退到 MockPlanner
    if (opts.llm) {
      this.planner = new LLMPlanner(opts.llm, this.registry, opts.maxSteps ?? 10);
      console.log('[aether:agent-runner] ✅ AgentRunner initialized with LLMPlanner (real LLM)');
    } else {
      this.planner = new MockPlanner(this.registry, opts.maxSteps ?? 10);
      console.log('[aether:agent-runner] ⚠️ AgentRunner initialized with MockPlanner (no LLM configured)');
    }

    console.log(`[aether:agent-runner]   registered tools: ${this.registry.list().map(t => t.name).join(', ')}`);
  }

  /**
   * 执行 Agent 任务
   */
  async run(task: string, sessionId?: string): Promise<AgentRunResult> {
    const sid = sessionId ?? randomUUID();
    const startedAt = new Date().toISOString();
    const t0 = Date.now();

    console.log(`[aether:agent-runner] 🚀 Session ${sid} — task: "${task.slice(0, 80)}"`);

    let plannerResult;
    try {
      plannerResult = await this.planner.plan(task);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - t0;

      const record: SessionRecord = {
        sessionId: sid,
        task,
        startedAt,
        completedAt: new Date().toISOString(),
        ok: false,
        answer: `Agent 运行失败：${error}`,
        stepCount: 0,
        durationMs,
      };
      this.sessions.set(sid, record);

      return {
        ok: false,
        sessionId: sid,
        answer: record.answer,
        steps: [],
        durationMs,
        error,
      };
    }

    const durationMs = Date.now() - t0;
    const completedAt = new Date().toISOString();

    // 将每个步骤写入 L1 记忆
    if (this.memory) {
      for (const step of plannerResult.steps) {
        const memContent = [
          `[agent-step] session=${sid} step=${step.stepIndex}`,
          `thought: ${step.thought}`,
          step.action ? `action: ${step.action.tool}(${JSON.stringify(step.action.params).slice(0, 100)})` : '',
          step.observation ? `observation: ${step.observation.slice(0, 200)}` : '',
          step.isFinal ? `final-answer: ${step.answer?.slice(0, 200)}` : '',
        ].filter(Boolean).join('\n');

        this.memory.remember(memContent, {
          source: 'agent-loop',
          sessionId: sid,
          importance: step.isFinal ? 0.8 : 0.5,
          tags: ['agent-step', step.action?.tool ?? 'no-tool'],
        }, ['working']);
      }
    }

    // 记录 session
    const record: SessionRecord = {
      sessionId: sid,
      task,
      startedAt,
      completedAt,
      ok: plannerResult.ok,
      answer: plannerResult.answer,
      stepCount: plannerResult.steps.length,
      durationMs,
    };
    this.sessions.set(sid, record);

    console.log(
      `[aether:agent-runner] ✅ Session ${sid} done — ok=${plannerResult.ok} steps=${plannerResult.steps.length} ${durationMs}ms`
    );

    return {
      ok: plannerResult.ok,
      sessionId: sid,
      answer: plannerResult.answer,
      steps: plannerResult.steps,
      durationMs,
      error: plannerResult.error,
    };
  }

  /**
   * 列出历史 session
   */
  listSessions(limit = 20): SessionRecord[] {
    const all = Array.from(this.sessions.values());
    return all.slice(-limit).reverse();
  }

  /**
   * 获取指定 session 详情
   */
  getSession(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 向注册表追加自定义工具（供外部扩展使用）
   */
  registerTool(tool: Parameters<ToolRegistry['register']>[0]): void {
    this.registry.register(tool);
  }

  /**
   * 返回 ToolRegistry（供 LLMPlanner 等外部组件复用已注册工具）
   */
  getRegistry(): ToolRegistry {
    return this.registry;
  }
}
