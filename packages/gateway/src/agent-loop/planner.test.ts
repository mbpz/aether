// MockPlanner contract tests — B8.2.
// 关键字匹配 + ReAct 循环。 不调真工具——把 registry 用 simple stub。
import { describe, it, expect } from 'vitest';
import { ToolRegistry } from './tools.js';
import { MockPlanner } from './planner.js';

function makeStubRegistry() {
  const r = new ToolRegistry();
  // exec_code stub returns {ok:true,output:42}; 其它 stub 返回 {ok:true}。
  r.register({
    name: 'exec_code',
    description: 'exec',
    parameters: { type: 'object' },
    async execute() { return { ok: true, output: 42 }; },
  });
  r.register({
    name: 'remember',
    description: 'remember',
    parameters: { type: 'object' },
    async execute() { return { ok: true }; },
  });
  r.register({
    name: 'recall',
    description: 'recall',
    parameters: { type: 'object' },
    async execute() { return { entries: [], total: 0 }; },
  });
  r.register({
    name: 'get_status',
    description: 'status',
    parameters: { type: 'object' },
    async execute() { return { status: 'ok' }; },
  });
  return r;
}

describe('MockPlanner', () => {
  describe('keyword matching', () => {
    it('matches "exec" / "执行" / "计算" → exec_code', async () => {
      const r = new MockPlanner(makeStubRegistry());
      for (const t of ['exec this code', '执行 1+1', '计算 42']) {
        const p = await r.plan(t);
        const action = p.steps.find((s) => s.action)?.action;
        expect(action?.tool).toBe('exec_code');
      }
    });

    it('matches "remember" / "记住" → remember', async () => {
      const r = new MockPlanner(makeStubRegistry());
      const p = await r.plan('remember this fact');
      expect(p.steps.find((s) => s.action)?.action?.tool).toBe('remember');
    });

    it('matches "recall" / "回忆" → recall', async () => {
      const r = new MockPlanner(makeStubRegistry());
      const p = await r.plan('recall last session');
      expect(p.steps.find((s) => s.action)?.action?.tool).toBe('recall');
    });

    it('matches "status" / "健康" → get_status', async () => {
      const r = new MockPlanner(makeStubRegistry());
      const p = await r.plan('check gateway status');
      expect(p.steps.find((s) => s.action)?.action?.tool).toBe('get_status');
    });
  });

  describe('unmatched task', () => {
    it('returns a final step with no action', async () => {
      const r = new MockPlanner(makeStubRegistry());
      const p = await r.plan('xyzzy nothing matches');
      expect(p.ok).toBe(true);
      const final = p.steps.find((s) => s.isFinal);
      expect(final).toBeDefined();
      expect(final?.action).toBeUndefined();
      expect(p.answer).toBeDefined();
    });
  });

  describe('extractCodeFromTask (fenced vs inline)', () => {
    it('extracts fenced ```...``` blocks', async () => {
      const r = new MockPlanner(makeStubRegistry());
      // "exec" is in the rule keywords; "run code" would also match but
      // "run" alone does not.
      const p = await r.plan('exec this:\n```js\nreturn 42;\n```');
      const action = p.steps.find((s) => s.action);
      expect(action?.action?.tool).toBe('exec_code');
      expect((action?.action?.params as { code: string }).code).toContain('return 42');
    });

    it('falls back to inline `...` backticks', async () => {
      const r = new MockPlanner(makeStubRegistry());
      const p = await r.plan('exec `1 + 2`');
      const action = p.steps.find((s) => s.action);
      expect((action?.action?.params as { code: string }).code).toBe('1 + 2');
    });
  });

  describe('plan output shape', () => {
    it('returns steps with stepIndex 0, 1, ...', async () => {
      const r = new MockPlanner(makeStubRegistry());
      const p = await r.plan('run something');
      p.steps.forEach((s, i) => {
        expect(s.stepIndex).toBe(i);
      });
    });

    it('final step has isFinal=true and answer', async () => {
      const r = new MockPlanner(makeStubRegistry());
      const p = await r.plan('exec anything');
      const final = p.steps[p.steps.length - 1];
      expect(final.isFinal).toBe(true);
      expect(final.answer).toBeDefined();
      expect(final.answer!.length).toBeGreaterThan(0);
    });
  });
});