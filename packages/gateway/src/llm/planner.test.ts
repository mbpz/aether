// LLMPlanner contract tests — B8.5. Stubs the LLM provider with
// response scripts so the test owns the conversation flow.
import { describe, it, expect } from 'vitest';
import { LLMProvider } from './provider.js';
import { ToolRegistry } from '../agent-loop/tools.js';
import { LLMPlanner } from './planner.js';

interface ChatResp {
  choices: Array<{
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
}

function stubProvider(responses: ChatResp[]): LLMProvider {
  // Cast the partial stub through unknown to satisfy the LLMProvider
  // type — we only need .chat() in LLMPlanner.
  const stub = {
    async chat(): Promise<ChatResp> {
      const next = responses.shift();
      if (!next) {
        return { choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }] };
      }
      return next;
    },
  } as unknown as LLMProvider;
  return stub;
}

function makeRegistry() {
  const r = new ToolRegistry();
  r.register({
    name: 'echo',
    description: 'echoes input',
    parameters: { type: 'object' },
    async execute(p) { return { ok: true, value: p.value }; },
  });
  return r;
}

describe('LLMPlanner', () => {
  describe('single-step final answer', () => {
    it('records a single step with the assistant content as answer', async () => {
      const llm = stubProvider([
        { choices: [{ message: { role: 'assistant', content: 'the answer is 42' }, finish_reason: 'stop' }] },
      ]);
      const p = new LLMPlanner(llm, makeRegistry());
      const r = await p.plan('what is the answer?');
      expect(r.answer).toBe('the answer is 42');
      expect(r.ok).toBe(true);
      expect(r.steps.length).toBe(1);
      expect(r.steps[0].isFinal).toBe(true);
    });
  });

  describe('tool-call flow (one round)', () => {
    it('invokes a tool, then concludes on the next LLM response', async () => {
      const llm = stubProvider([
        // Round 1: tool call
        {
          choices: [{
            message: {
              role: 'assistant',
              content: 'let me echo',
              tool_calls: [{ id: 'call-1', function: { name: 'echo', arguments: '{"value":"hi"}' } }],
            },
            finish_reason: 'tool_calls',
          }],
        },
        // Round 2: final answer
        { choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }] },
      ]);
      const p = new LLMPlanner(llm, makeRegistry());
      const r = await p.plan('echo hi');
      expect(r.ok).toBe(true);
      expect(r.answer).toBe('done');
      expect(r.steps.length).toBe(2);
      expect(r.steps[0].action?.tool).toBe('echo');
      expect(r.steps[0].isFinal).toBe(false);
      expect(r.steps[0].observation).toContain('hi');
      expect(r.steps[1].isFinal).toBe(true);
    });
  });

  describe('unknown tool', () => {
    it('records an observation with the error and continues', async () => {
      const llm = stubProvider([
        {
          choices: [{
            message: {
              role: 'assistant',
              content: 'try something',
              tool_calls: [{ id: 'call-1', function: { name: 'no-such-tool', arguments: '{}' } }],
            },
            finish_reason: 'tool_calls',
          }],
        },
        { choices: [{ message: { role: 'assistant', content: 'fallback' }, finish_reason: 'stop' }] },
      ]);
      const p = new LLMPlanner(llm, makeRegistry());
      const r = await p.plan('whatever');
      expect(r.ok).toBe(true);
      expect(r.steps[0].observation).toMatch(/未注册/);
    });
  });

  describe('LLM error', () => {
    it('returns ok:false with the error message', async () => {
      const stub = {
        async chat(): Promise<ChatResp> {
          throw new Error('API down');
        },
      } as unknown as LLMProvider;
      const p = new LLMPlanner(stub, makeRegistry());
      const r = await p.plan('task');
      expect(r.ok).toBe(false);
      expect(r.error).toBe('API down');
    });
  });

  describe('empty response', () => {
    it('returns ok:false when LLM returns no choices', async () => {
      const llm = stubProvider([{ choices: [] }]);
      const p = new LLMPlanner(llm, makeRegistry());
      const r = await p.plan('task');
      expect(r.ok).toBe(false);
    });
  });

  describe('maxSteps enforcement', () => {
    it('stops after maxSteps even if LLM keeps calling tools', async () => {
      // Provide enough tool-call responses to exhaust maxSteps.
      const responses: ChatResp[] = [];
      for (let i = 0; i < 5; i++) {
        responses.push({
          choices: [{
            message: {
              role: 'assistant',
              content: 'loop',
              tool_calls: [{ id: `c-${i}`, function: { name: 'echo', arguments: '{"value":"x"}' } }],
            },
            finish_reason: 'tool_calls',
          }],
        });
      }
      responses.push({ choices: [{ message: { role: 'assistant', content: 'final' }, finish_reason: 'stop' }] });
      const llm = stubProvider(responses);
      const p = new LLMPlanner(llm, makeRegistry(), 3); // max 3 steps
      const r = await p.plan('infinite loop');
      // The planner loop is `for (let i = 0; i < maxSteps; i++)` so
      // with maxSteps=3 it executes the body at most 3 times. Each
      // iteration pushes one tool step. Plus a possible final step if
      // the last iteration returns a stop finish_reason. Total ≤ 4.
      expect(r.steps.length).toBeLessThanOrEqual(4);
    });
  });
});