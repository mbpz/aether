// ToolRegistry + createBuiltinTools — B8.2 retro-fit.
import { describe, it, expect } from 'vitest';
import { ToolRegistry, createBuiltinTools } from './tools.js';

describe('ToolRegistry', () => {
  describe('register + get + list', () => {
    it('register stores a tool reachable by name', () => {
      const r = new ToolRegistry();
      const tool = {
        name: 'greet',
        description: 'say hi',
        parameters: { type: 'object' },
        async execute() { return 'hi'; },
      };
      r.register(tool);
      expect(r.get('greet')).toBe(tool);
    });

    it('overwriting logs a warning (not tested) but replaces the tool', () => {
      const r = new ToolRegistry();
      const v1 = { name: 't', description: 'v1', parameters: { type: 'object' }, async execute() { return 1; } };
      const v2 = { name: 't', description: 'v2', parameters: { type: 'object' }, async execute() { return 2; } };
      r.register(v1);
      r.register(v2);
      expect(r.get('t')).toBe(v2);
    });

    it('get returns undefined for unknown name', () => {
      expect(new ToolRegistry().get('nope')).toBeUndefined();
    });

    it('list returns all tools', () => {
      const r = new ToolRegistry();
      r.register({ name: 'a', description: '', parameters: { type: 'object' }, async execute() {} });
      r.register({ name: 'b', description: '', parameters: { type: 'object' }, async execute() {} });
      expect(r.list().length).toBe(2);
    });
  });
});

describe('createBuiltinTools', () => {
  it('returns 4 tools: exec_code, remember, recall, get_status', () => {
    const tools = createBuiltinTools();
    expect(tools.length).toBe(4);
    expect(tools.map((t) => t.name).sort()).toEqual(['exec_code', 'get_status', 'recall', 'remember']);
  });

  it('exec_code fails closed when no sandbox backend is wired', async () => {
    const tools = createBuiltinTools();
    const exec = tools.find((t) => t.name === 'exec_code')!;
    const r = await exec.execute({ code: '1+1' });
    expect((r as { ok: boolean }).ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/No sandbox backend|unsafe JS/);
  });

  it('exec_code rejects empty code', async () => {
    const tools = createBuiltinTools();
    const exec = tools.find((t) => t.name === 'exec_code')!;
    const r = await exec.execute({ code: '   ' });
    expect((r as { ok: boolean }).ok).toBe(false);
  });

  it('exec_code uses deps.execCode when provided', async () => {
    const tools = createBuiltinTools({
      execCode: async (code) => ({ ok: true, output: code.length }),
    });
    const exec = tools.find((t) => t.name === 'exec_code')!;
    const r = await exec.execute({ code: 'hello' });
    expect((r as { ok: boolean; output: number }).ok).toBe(true);
    expect((r as { ok: boolean; output: number }).output).toBe(5);
  });

  it('remember uses deps.rememberFn when provided', async () => {
    const tools = createBuiltinTools({
      rememberFn: (content, meta) => ({ id: 'mock-id', content, meta }),
    });
    const remember = tools.find((t) => t.name === 'remember')!;
    const r = await remember.execute({ content: 'note', importance: 0.8 });
    expect((r as { ok: boolean }).ok).toBe(true);
  });

  it('recall returns empty when no deps.recallFn', async () => {
    const tools = createBuiltinTools();
    const recall = tools.find((t) => t.name === 'recall')!;
    const r = await recall.execute({ query: 'foo' });
    expect((r as { entries: unknown[] }).entries).toEqual([]);
  });

  it('get_status returns ok + system name even without deps', async () => {
    const tools = createBuiltinTools();
    const getStatus = tools.find((t) => t.name === 'get_status')!;
    const r = await getStatus.execute({});
    expect((r as { status: string; system: string }).status).toBe('ok');
    expect((r as { status: string; system: string }).system).toBe('aether-gateway');
  });
});