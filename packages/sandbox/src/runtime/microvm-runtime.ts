// MicroVM Runtime - Kata Containers + Firecracker 高安全沙箱
// T-017: Phase 3 高安全模式
//
// 提供基于轻量级虚拟机的代码执行隔离：
//   - Kata Containers: 完整 microVM，更强隔离（使用 kata-runtime CLI）
//   - Firecracker: 轻量级 VMM，更快启动（使用 firecracker 二进制）

import { randomUUID } from 'crypto';
import { FirecrackerRuntime, FirecrackerVMConfig } from './firecracker.js';
import { KataRuntime, KataVMConfig } from './kata-runtime.js';

// ── 类型定义 ─────────────────────────────────────────────────────────────

export interface MicroVMConfig {
  kernelPath: string;
  initrdPath?: string;
  memoryMB: number;
  vcpus: number;
  rootDrive?: string;        // VM image path
  networkEnabled: boolean;
  KataContainers?: boolean;  // true = Kata Containers, false = Firecracker
}

export interface MicroVMResult {
  vmId: string;
  started: boolean;
  pid?: number;             // kata-runtime/firecracker process
  ipAddress?: string;
  durationMs: number;
}

export interface MicroVMExecutionResult {
  vmId: string;
  ok: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs: number;
}

interface VMEntry {
  vmId: string;
  config: MicroVMConfig;
  startedAt: string;
  pid?: number;
  ipAddress?: string;
  status: 'initializing' | 'running' | 'stopping' | 'stopped';
}

// ── MicroVMRuntime 主类 ─────────────────────────────────────────────────

/**
 * MicroVMRuntime - 统一的 MicroVM 运行时接口
 *
 * 根据配置自动选择底层实现：
 *   - KataContainers: true  → KataRuntime（完整 VM 隔离）
 *   - KataContainers: false → FirecrackerRuntime（轻量级 VMM）
 */
export class MicroVMRuntime {
  private runtime: FirecrackerRuntime | KataRuntime;
  private vms = new Map<string, VMEntry>();
  private defaultConfig: MicroVMConfig;

  constructor(defaultConfig?: Partial<MicroVMConfig>) {
    this.defaultConfig = {
      kernelPath: defaultConfig?.kernelPath ?? '/var/lib/aether/vmlinux',
      initrdPath: defaultConfig?.initrdPath,
      memoryMB: defaultConfig?.memoryMB ?? 512,
      vcpus: defaultConfig?.vcpus ?? 2,
      rootDrive: defaultConfig?.rootDrive,
      networkEnabled: defaultConfig?.networkEnabled ?? false,
      KataContainers: defaultConfig?.KataContainers ?? false,
    };

    // 根据配置选择运行时
    if (this.defaultConfig.KataContainers) {
      this.runtime = new KataRuntime();
      console.log('[aether:microvm] Using Kata Containers runtime (full microVM isolation)');
    } else {
      this.runtime = new FirecrackerRuntime();
      console.log('[aether:microvm] Using Firecracker runtime (lightweight VMM)');
    }
  }

  /**
   * 初始化 VM 运行时
   */
  async init(): Promise<void> {
    await this.runtime.init();
    console.log('[aether:microvm] Runtime initialized');
  }

  /**
   * 启动一个隔离的 MicroVM 并执行代码
   * @param skillId Skill 标识符（用于日志）
   * @param code 要执行的代码
   * @param config 覆盖默认配置
   */
  async startVM(
    skillId: string,
    code: string,
    config?: Partial<MicroVMConfig>
  ): Promise<MicroVMResult> {
    const vmId = `microvm-${randomUUID().slice(0, 8)}`;
    const startTime = Date.now();
    const mergedConfig: MicroVMConfig = { ...this.defaultConfig, ...config };

    // 记录 VM
    this.vms.set(vmId, {
      vmId,
      config: mergedConfig,
      startedAt: new Date().toISOString(),
      status: 'initializing',
    });

    try {
      // 根据配置选择 Kata 或 Firecracker
      if (mergedConfig.KataContainers) {
        const kataConfig: KataVMConfig = {
          kernelPath: mergedConfig.kernelPath,
          initrdPath: mergedConfig.initrdPath,
          memoryMB: mergedConfig.memoryMB,
          vcpus: mergedConfig.vcpus,
          rootDrive: mergedConfig.rootDrive,
          networkEnabled: mergedConfig.networkEnabled,
        };
        const kataRuntime = this.runtime as KataRuntime;
        const result = await kataRuntime.startVM(vmId, skillId, code, kataConfig);
        this.vms.set(vmId, {
          ...this.vms.get(vmId)!,
          pid: result.pid,
          ipAddress: result.ipAddress,
          status: 'running',
        });
        return { ...result, durationMs: Date.now() - startTime };
      } else {
        const fcConfig: FirecrackerVMConfig = {
          kernelPath: mergedConfig.kernelPath,
          initrdPath: mergedConfig.initrdPath,
          memoryMB: mergedConfig.memoryMB,
          vcpus: mergedConfig.vcpus,
          rootDrive: mergedConfig.rootDrive,
          networkEnabled: mergedConfig.networkEnabled,
        };
        const fcRuntime = this.runtime as FirecrackerRuntime;
        const result = await fcRuntime.startVM(vmId, skillId, code, fcConfig);
        this.vms.set(vmId, {
          ...this.vms.get(vmId)!,
          pid: result.pid,
          ipAddress: result.ipAddress,
          status: 'running',
        });
        return { ...result, durationMs: Date.now() - startTime };
      }
    } catch (err) {
      this.vms.set(vmId, {
        ...this.vms.get(vmId)!,
        status: 'stopped',
      });
      const error = err instanceof Error ? err.message : String(err);
      return {
        vmId,
        started: false,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 停止指定的 MicroVM
   */
  async stopVM(vmId: string): Promise<void> {
    const entry = this.vms.get(vmId);
    if (!entry) {
      throw new Error(`VM ${vmId} not found`);
    }

    entry.status = 'stopping';

    try {
      if (entry.config.KataContainers) {
        await (this.runtime as KataRuntime).stopVM(vmId);
      } else {
        await (this.runtime as FirecrackerRuntime).stopVM(vmId);
      }
      entry.status = 'stopped';
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[aether:microvm] Failed to stop VM ${vmId}: ${error}`);
      entry.status = 'stopped';
    }
  }

  /**
   * 获取 VM 状态
   */
  getVMStatus(vmId: string): VMEntry | undefined {
    return this.vms.get(vmId);
  }

  /**
   * 列出所有运行中的 VM
   */
  listVMs(): VMEntry[] {
    return Array.from(this.vms.values()).filter(
      vm => vm.status === 'initializing' || vm.status === 'running'
    );
  }

  /**
   * 清理所有 VM（进程退出时调用）
   */
  async cleanup(): Promise<void> {
    console.log(`[aether:microvm] Cleaning up ${this.vms.size} VMs...`);

    const vmIds = Array.from(this.vms.keys());
    for (const vmId of vmIds) {
      try {
        await this.stopVM(vmId);
      } catch {
        // Ignore cleanup errors
      }
    }

    this.vms.clear();
    console.log('[aether:microvm] All VMs cleaned up');
  }

  /**
   * 获取运行时统计信息
   */
  stats() {
    return {
      totalVMs: this.vms.size,
      runningVMs: this.listVMs().length,
      runtime: this.defaultConfig.KataContainers ? 'kata' : 'firecracker',
    };
  }
}
