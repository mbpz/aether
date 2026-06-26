// SandboxRuntime contract tests — B8.1 retro-fit.
//
// 测策略：测 scanCode rejection 路径（不需要 init 成功），不测真实的 V8
// isolate 执行——isolated-vm 在 CI 上不一定 build 得通 (B0 已记录此前提
// 在 ADR-001)。真实执行测试由 bridge.test.ts 的静态守护 + integration
// tests 覆盖。
import { describe, it, expect } from 'vitest';
import { SecurityPolicy } from '../security/policy.js';
import { SandboxRuntime } from './sandbox.js';

const policy = new SecurityPolicy({
  blockNetwork: true,
  blockFilesystem: true,
  blockProcessSpawn: true,
  maxExecTimeMs: 5000,
  maxMemoryMb: 64,
});

describe('SandboxRuntime', () => {
  describe('rejection path (no init required)', () => {
    it('execute() rejects network-using code before invoking ivm', async () => {
      const rt = new SandboxRuntime(policy);
      // Note: NOT calling rt.init() — we want to verify the scanCode gate
      // rejects without ever loading isolated-vm.
      const r = await rt.execute({ code: "const h = require('http'); h.get('https://x')" });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('Security policy violation');
      expect(r.violations?.length).toBeGreaterThanOrEqual(1);
      expect(r.id).toBeDefined();
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
      expect(r.exitedAt).toBeDefined();
    });

    it('execute() rejects filesystem access before invoking ivm', async () => {
      const rt = new SandboxRuntime(policy);
      const r = await rt.execute({ code: "const fs = require('fs'); fs.writeFileSync('/etc/x','y')" });
      expect(r.ok).toBe(false);
      expect(r.violations?.some((v) => v.type === 'filesystem')).toBe(true);
    });

    it('execute() rejects process spawn before invoking ivm', async () => {
      const rt = new SandboxRuntime(policy);
      const r = await rt.execute({ code: 'process.exit(0)' });
      expect(r.ok).toBe(false);
      expect(r.violations?.some((v) => v.type === 'process')).toBe(true);
    });
  });

  describe('id and timestamp handling', () => {
    it('assigns a random uuid when no id provided', async () => {
      const rt = new SandboxRuntime(policy);
      const r1 = await rt.execute({ code: 'fetch("http://x")' });
      const r2 = await rt.execute({ code: 'fetch("http://y")' });
      expect(r1.id).not.toBe(r2.id);
    });

    it('preserves caller-provided id', async () => {
      const rt = new SandboxRuntime(policy);
      const r = await rt.execute({ id: 'my-custom-id', code: 'fetch("http://x")' });
      expect(r.id).toBe('my-custom-id');
    });

    it('exitedAt is a valid ISO timestamp', async () => {
      const rt = new SandboxRuntime(policy);
      const r = await rt.execute({ code: 'fetch("http://x")' });
      expect(() => new Date(r.exitedAt)).not.toThrow();
      expect(new Date(r.exitedAt).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });
});
