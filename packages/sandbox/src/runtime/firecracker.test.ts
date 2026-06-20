// FirecrackerRuntime 测试（Batch 3 合并后）
// 验证单 VM API + 暖池 API 都工作。非 Linux 走 mock 路径，CI 上可跑。
import { describe, it, expect } from 'vitest';
import { FirecrackerRuntime } from './firecracker.js';

describe('FirecrackerRuntime', () => {
  const baseConfig = {
    kernelPath: '/var/lib/aether/vmlinux',
    memoryMB: 256,
    vcpus: 1,
    networkEnabled: false,
  };

  describe('单 VM API', () => {
    it('init() 不抛错（mock 模式）', async () => {
      const rt = new FirecrackerRuntime();
      await expect(rt.init()).resolves.toBeUndefined();
    });

    it('startVM() 在 mock 模式返回 started=true', async () => {
      const rt = new FirecrackerRuntime();
      await rt.init();
      const result = await rt.startVM('vm-1', 'skill-x', 'echo hi', baseConfig);
      expect(result.started).toBe(true);
      expect(result.vmId).toBe('vm-1');
    });

    it('getVMStatus() 返回已启动 VM', async () => {
      const rt = new FirecrackerRuntime();
      await rt.init();
      await rt.startVM('vm-2', 'skill-x', 'echo hi', baseConfig);
      expect(rt.getVMStatus('vm-2')?.state).toBe('running');
    });

    it('executeInVM() 在运行中的 VM 上返回 ok', async () => {
      const rt = new FirecrackerRuntime();
      await rt.init();
      await rt.startVM('vm-3', 'skill-x', 'echo hi', baseConfig);
      const exec = await rt.executeInVM('vm-3', 'echo hi');
      expect(exec.ok).toBe(true);
    });

    it('executeInVM() 在不存在的 VM 上返回 ok=false', async () => {
      const rt = new FirecrackerRuntime();
      await rt.init();
      const exec = await rt.executeInVM('nope', 'echo');
      expect(exec.ok).toBe(false);
    });

    it('stopVM() 移除 VM', async () => {
      const rt = new FirecrackerRuntime();
      await rt.init();
      await rt.startVM('vm-4', 'skill-x', 'echo', baseConfig);
      await rt.stopVM('vm-4');
      expect(rt.getVMStatus('vm-4')).toBeUndefined();
    });

    it('listVMs() 反映当前活跃 VM', async () => {
      const rt = new FirecrackerRuntime();
      await rt.init();
      await rt.startVM('vm-5', 'skill', 'echo', baseConfig);
      await rt.startVM('vm-6', 'skill', 'echo', baseConfig);
      expect(rt.listVMs().length).toBe(2);
    });
  });

  describe('暖池 API', () => {
    it('poolStats() 初始为空', () => {
      const rt = new FirecrackerRuntime();
      expect(rt.poolStats()).toEqual({ total: 0, ready: 0, busy: 0 });
    });

    it('startPoolVM() 在池满时抛错', async () => {
      const rt = new FirecrackerRuntime(undefined, undefined, 1);
      await rt.startPoolVM();
      await expect(rt.startPoolVM()).rejects.toThrow(/Pool exhausted/);
    });

    it('acquire() 把 ready VM 标记为 busy', async () => {
      const rt = new FirecrackerRuntime(undefined, undefined, 2);
      await rt.startPoolVM();
      const vm = rt.acquire();
      expect(vm).not.toBeNull();
      expect(rt.poolStats().busy).toBe(1);
    });

    it('release() 把 busy VM 还回 ready', async () => {
      const rt = new FirecrackerRuntime(undefined, undefined, 2);
      await rt.startPoolVM();
      const vm = rt.acquire()!;
      rt.release(vm.id);
      expect(rt.poolStats().ready).toBe(1);
      expect(rt.poolStats().busy).toBe(0);
    });

    it('acquire() 在无 ready VM 时返回 null', () => {
      const rt = new FirecrackerRuntime();
      expect(rt.acquire()).toBeNull();
    });
  });
});
