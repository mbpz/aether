// EP-07: LLM Planner - 真实 ReAct 循环
// 替换 MockPlanner，用 LLM 驱动 Thought → Action → Observation → Answer
// 兼容 OpenAI function calling 格式

import { randomUUID } from 'crypto';
import type { LLMProvider } from './provider.js';
import type { ToolRegistry, Tool } from '../agent-loop/tools.js';
import type { AgentStep, PlannerResult } from '../agent-loop/planner.js';
import type { ChatMessage, ToolCall } from './types.js';

// ── System Prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Aether, a zero-trust AI agent.
You follow the ReAct pattern: Thought → Action → Observation → Thought … → Final Answer.

Rules:
1. Always start with a Thought before any action.
2. Use the available tools when needed. Call only ONE tool per step.
3. After receiving an Observation, decide: continue (another tool call) or answer.
4. When you have enough information, produce a Final Answer in plain language.
5. Keep Thoughts concise (1-2 sentences).
6. Respond in the same language as the user's message.`;

// ── LLMPlanner ────────────────────────────────────────────────────────────────

export class LLMPlanner {
  private llm: LLMProvider;
  private registry: ToolRegistry;
  private maxSteps: number;

  constructor(llm: LLMProvider, registry: ToolRegistry, maxSteps = 10) {
    this.llm = llm;
    this.registry = registry;
    this.maxSteps = maxSteps;
  }

  async plan(task: string): Promise<PlannerResult> {
    const steps: AgentStep[] = [];
    const tools = this.registry.list();
    const toolDefs = tools.map(toolToFunctionDef);

    // 初始消息历史
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: task },
    ];

    let stepIndex = 0;
    let finalAnswer = '';
    let lastError: string | undefined;

    for (let i = 0; i < this.maxSteps; i++) {
      stepIndex = i;

      let resp;
      try {
        resp = await this.llm.chat(messages, { tools: toolDefs });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        const errStep: AgentStep = {
          stepIndex,
          thought: `LLM 调用失败：${lastError}`,
          isFinal: true,
          answer: `Agent 遇到错误：${lastError}`,
        };
        steps.push(errStep);
        return { steps, answer: errStep.answer!, ok: false, error: lastError };
      }

      const choice = resp.choices?.[0];
      if (!choice) {
        lastError = 'Empty response from LLM';
        break;
      }

      const assistantMsg = choice.message;
      const finishReason = choice.finish_reason;

      // ── 工具调用 ──────────────────────────────────────────────────────────
      if (finishReason === 'tool_calls' && assistantMsg.tool_calls?.length) {
        const toolCall = assistantMsg.tool_calls[0]; // 每步只处理第一个
        const thought = assistantMsg.content ?? `决定调用工具 ${toolCall.function.name}`;

        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments);
        } catch (_) {
          parsedArgs = {};
        }

        const step: AgentStep = {
          stepIndex,
          thought,
          action: {
            tool: toolCall.function.name,
            params: parsedArgs,
          },
          isFinal: false,
        };

        // 执行工具
        const tool = this.registry.get(toolCall.function.name);
        let observationText: string;

        if (!tool) {
          observationText = `错误：工具 "${toolCall.function.name}" 未注册。可用工具：${tools.map(t => t.name).join(', ')}`;
        } else {
          try {
            const result = await tool.execute(parsedArgs);
            observationText = typeof result === 'string'
              ? result
              : JSON.stringify(result).slice(0, 500);
          } catch (err) {
            observationText = `工具执行失败：${err instanceof Error ? err.message : String(err)}`;
          }
        }

        step.observation = observationText;
        steps.push(step);

        // 把 assistant 工具调用 + tool result 加入消息历史
        messages.push({
          role: 'assistant',
          content: assistantMsg.content ?? null as any,
          tool_calls: assistantMsg.tool_calls,
        });
        messages.push({
          role: 'tool',
          content: observationText,
          tool_call_id: toolCall.id,
        });

        continue; // 继续循环，等待 LLM 下一步决策
      }

      // ── Final Answer ──────────────────────────────────────────────────────
      finalAnswer = assistantMsg.content ?? '';

      const concludeStep: AgentStep = {
        stepIndex,
        thought: '我已收集足够信息，现在给出最终答案。',
        isFinal: true,
        answer: finalAnswer,
      };
      steps.push(concludeStep);

      return {
        steps,
        answer: finalAnswer,
        ok: true,
      };
    }

    // 超出最大步骤
    if (!finalAnswer) {
      finalAnswer = `已达到最大步骤数 (${this.maxSteps})，无法完成任务：${task}`;
      steps.push({
        stepIndex,
        thought: '已达到最大步骤数限制。',
        isFinal: true,
        answer: finalAnswer,
      });
    }

    return { steps, answer: finalAnswer, ok: !lastError, error: lastError };
  }
}

// ── 工具格式转换 ─────────────────────────────────────────────────────────────

function toolToFunctionDef(tool: Tool) {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as {
        type: 'object';
        properties: Record<string, { type: string; description?: string }>;
        required?: string[];
      },
    },
  };
}
