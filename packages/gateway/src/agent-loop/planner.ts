// EP-05: Agent Loop - ReAct 规划器
// 实现 Thought → Action → Observation → Final Answer 循环
// MockPlanner 基于规则选择工具，无需真实 LLM，可完整测试

import type { ToolRegistry } from './tools.js';

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface AgentStep {
  stepIndex: number;
  thought: string;
  action?: {
    tool: string;
    params: unknown;
  };
  observation?: string;
  isFinal: boolean;
  answer?: string;
}

export interface PlannerResult {
  steps: AgentStep[];
  answer: string;
  ok: boolean;
  error?: string;
}

// ── 规则条目：关键词 → 工具名 + 参数提取器 ───────────────────────────────────

interface ToolRule {
  keywords: RegExp[];
  toolName: string;
  buildParams: (task: string) => Record<string, unknown>;
  buildThought: (task: string) => string;
  buildObservation: (result: unknown) => string;
}

const TOOL_RULES: ToolRule[] = [
  {
    keywords: [/执行|运行|eval|exec|代码|calculate|计算|run\s+code/i],
    toolName: 'exec_code',
    buildParams: (task) => ({
      code: extractCodeFromTask(task),
    }),
    buildThought: (task) =>
      `任务需要执行代码："${task.slice(0, 80)}"。我应该使用 exec_code 工具运行它。`,
    buildObservation: (result) =>
      `代码执行结果：${JSON.stringify(result).slice(0, 300)}`,
  },
  {
    keywords: [/记住|记忆|remember|store|保存|存储/i],
    toolName: 'remember',
    buildParams: (task) => ({ content: task, importance: 0.6 }),
    buildThought: (task) =>
      `任务要求记忆某些内容："${task.slice(0, 80)}"。我将使用 remember 工具写入记忆。`,
    buildObservation: (result) =>
      `记忆写入结果：${JSON.stringify(result).slice(0, 200)}`,
  },
  {
    keywords: [/回忆|检索|recall|查找|搜索|找到|search|find/i],
    toolName: 'recall',
    buildParams: (task) => ({ query: task, limit: 5 }),
    buildThought: (task) =>
      `任务需要检索记忆："${task.slice(0, 80)}"。我将使用 recall 工具检索相关内容。`,
    buildObservation: (result) => {
      const r = result as { entries?: unknown[]; total?: number } | null;
      const count = r?.entries?.length ?? 0;
      return `记忆检索完成，找到 ${count} 条相关记忆：${JSON.stringify(r?.entries ?? []).slice(0, 300)}`;
    },
  },
  {
    keywords: [/状态|status|健康|health|系统|system|gateway/i],
    toolName: 'get_status',
    buildParams: (_task) => ({}),
    buildThought: (_task) =>
      '任务需要了解 Gateway 系统状态。我将调用 get_status 工具。',
    buildObservation: (result) =>
      `系统状态：${JSON.stringify(result).slice(0, 300)}`,
  },
];

function extractCodeFromTask(task: string): string {
  // 1. 优先：fenced 代码块 ```...```
  const fenced = task.match(/```[\s\S]*?```/);
  if (fenced) {
    return fenced[0].replace(/```\w*\n?/, '').replace(/\n?```$/, '').trim();
  }
  // 2. 行内反引号 `code`
  const inline = task.match(/`([^`]+)`/);
  if (inline) return inline[1].trim();
  // 3. 裸代码片段：冒号后的内容，如 "execute: return 2+2" 或 "执行代码：1+1"
  //    匹配 "执行|exec|run|calculate|代码|eval" 后跟中英文冒号和代码
  const bareColon = task.match(
    /(?:执行|exec|run|calculate|计算|代码|eval)[：:]\s*(.+)/i
  );
  if (bareColon) return bareColon[1].trim();
  // 4. 如果整个任务文本看起来就是一段代码表达式（含运算符/关键字，无中文）
  //    直接用 task 本身作为代码（去掉前置动词短语后的内容）
  const stripped = task.replace(/^[\w\s]+(execute|run|eval)\s+/i, '').trim();
  if (stripped !== task && stripped.length > 0) return stripped;
  // 5. 最后退化：返回默认示例
  return `console.log("Hello from Aether Agent"); 42`;
}

// ── MockPlanner ───────────────────────────────────────────────────────────────

export class MockPlanner {
  private registry: ToolRegistry;
  private maxSteps: number;

  constructor(registry: ToolRegistry, maxSteps = 10) {
    this.registry = registry;
    this.maxSteps = maxSteps;
  }

  async plan(task: string): Promise<PlannerResult> {
    const steps: AgentStep[] = [];
    let currentTask = task;
    let finalAnswer = '';

    // 步骤1：分析任务，找到最匹配的工具规则
    const rule = this._matchRule(task);

    if (!rule) {
      // 没有匹配规则，直接给出答案
      const finalStep: AgentStep = {
        stepIndex: 0,
        thought: `收到任务："${task.slice(0, 100)}"。这是一个一般性问题，我将直接回答。`,
        isFinal: true,
        answer: `我已收到您的任务："${task}"。这是 Aether Agent (MockPlanner) 的响应——任务已记录，但当前没有匹配的工具规则来执行特定操作。`,
      };
      steps.push(finalStep);
      return { steps, answer: finalStep.answer!, ok: true };
    }

    // 执行 ReAct 循环
    for (let i = 0; i < this.maxSteps; i++) {
      const thought = rule.buildThought(currentTask);
      const toolName = rule.toolName;
      const tool = this.registry.get(toolName);

      if (!tool) {
        const errStep: AgentStep = {
          stepIndex: i,
          thought,
          isFinal: true,
          answer: `错误：工具 "${toolName}" 未注册。`,
        };
        steps.push(errStep);
        return { steps, answer: errStep.answer!, ok: false, error: `Tool not found: ${toolName}` };
      }

      const params = rule.buildParams(currentTask);
      const actionStep: AgentStep = {
        stepIndex: i,
        thought,
        action: { tool: toolName, params },
        isFinal: false,
      };

      // 执行工具
      let observationText: string;
      try {
        const result = await tool.execute(params as Record<string, unknown>);
        observationText = rule.buildObservation(result);
        actionStep.observation = observationText;
      } catch (err) {
        observationText = `工具执行失败：${err instanceof Error ? err.message : String(err)}`;
        actionStep.observation = observationText;
        actionStep.isFinal = true;
        actionStep.answer = `执行任务时遇到错误：${observationText}`;
        steps.push(actionStep);
        return { steps, answer: actionStep.answer, ok: false, error: observationText };
      }

      steps.push(actionStep);

      // 单工具任务：执行完即结束
      finalAnswer = `任务完成。工具 "${toolName}" 执行结果：${observationText}`;
      currentTask = `验证结果并总结：${observationText}`;
      break;
    }

    // 最终步骤：给出结论
    const concludeStep: AgentStep = {
      stepIndex: steps.length,
      thought: `我已完成工具调用，现在给出最终答案。`,
      isFinal: true,
      answer: finalAnswer || `任务 "${task.slice(0, 80)}" 已处理完毕。`,
    };
    steps.push(concludeStep);

    return {
      steps,
      answer: concludeStep.answer!,
      ok: true,
    };
  }

  private _matchRule(task: string): ToolRule | null {
    for (const rule of TOOL_RULES) {
      const matched = rule.keywords.some((re) => re.test(task));
      if (matched) {
        // 确保工具已注册
        if (this.registry.get(rule.toolName)) return rule;
      }
    }
    return null;
  }
}
