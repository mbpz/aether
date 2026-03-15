// CodeAct Engine - Agent 自调试闭环执行器
// 支持 Agent 在沙箱内生成并运行临时脚本进行自调试

import { randomUUID } from 'crypto';
import { SandboxRuntime, ExecutionResult } from '../runtime/sandbox.js';
import { SecurityPolicy } from '../security/policy.js';

export interface CodeActStep {
  stepId: string;
  thought: string;      // Agent 的推理过程（思维链）
  code: string;         // 生成的代码
  result?: ExecutionResult;
  nextAction?: 'continue' | 'retry' | 'done' | 'error';
}

export interface CodeActSession {
  sessionId: string;
  task: string;
  steps: CodeActStep[];
  status: 'running' | 'done' | 'error' | 'timeout';
  startedAt: string;
  completedAt?: string;
  finalOutput?: unknown;
}

export class CodeActEngine {
  private runtime: SandboxRuntime;
  private policy: SecurityPolicy;
  private sessions: Map<string, CodeActSession> = new Map();
  private readonly MAX_STEPS = 10; // 防止无限循环

  constructor(runtime: SandboxRuntime, policy: SecurityPolicy) {
    this.runtime = runtime;
    this.policy = policy;
  }

  /**
   * 创建一个 CodeAct 会话
   */
  createSession(task: string): CodeActSession {
    const session: CodeActSession = {
      sessionId: randomUUID(),
      task,
      steps: [],
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    this.sessions.set(session.sessionId, session);
    console.log(`[aether:codeact] Session ${session.sessionId} created for task: ${task.slice(0, 50)}...`);
    return session;
  }

  /**
   * 在会话中执行一步代码
   */
  async executeStep(
    sessionId: string,
    step: { thought: string; code: string; input?: unknown }
  ): Promise<CodeActStep> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status !== 'running') throw new Error(`Session ${sessionId} is ${session.status}`);

    if (session.steps.length >= this.MAX_STEPS) {
      session.status = 'error';
      throw new Error(`Max steps (${this.MAX_STEPS}) exceeded for session ${sessionId}`);
    }

    const codeActStep: CodeActStep = {
      stepId: randomUUID(),
      thought: step.thought,
      code: step.code,
    };

    // 在沙箱中执行
    const result = await this.runtime.execute({
      id: codeActStep.stepId,
      code: step.code,
      input: step.input,
    });

    codeActStep.result = result;

    // 根据执行结果决定下一步动作
    if (result.ok) {
      codeActStep.nextAction = 'continue';
      session.finalOutput = result.output;
    } else if (result.violations && result.violations.length > 0) {
      codeActStep.nextAction = 'error';
      session.status = 'error';
    } else {
      // 执行失败但无安全违规，可以重试
      codeActStep.nextAction = 'retry';
    }

    session.steps.push(codeActStep);

    console.log(`[aether:codeact] Step ${codeActStep.stepId} (session=${sessionId}): ${result.ok ? '✅' : '❌'} ${result.durationMs}ms`);

    return codeActStep;
  }

  /**
   * 完成会话
   */
  completeSession(sessionId: string): CodeActSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.status = 'done';
    session.completedAt = new Date().toISOString();
    return session;
  }

  /**
   * 获取会话详情
   */
  getSession(sessionId: string): CodeActSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 列出所有会话
   */
  listSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.sessionId,
      task: s.task.slice(0, 80),
      status: s.status,
      steps: s.steps.length,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
    }));
  }
}
