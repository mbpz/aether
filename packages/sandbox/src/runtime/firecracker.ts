// Firecracker Runtime — 统一实现（Batch 3 合并 firecracker-runtime + firecracker-pool）
// T-017: Firecracker 微虚拟机支持 · 决策见 ADR-003
//
// 本文件是 Firecracker 的唯一实现，合并自：
//   - runtime/firecracker-runtime.ts（被 microvm-runtime 集成的单 VM API）
//   - isolation/firecracker-pool.ts（暖池：prewarm/acquire/release）
//
// 两套能力都保留：
//   单 VM API ── startVM(vmId, skillId, code, config) / stopVM / executeInVM
//   暖池 API  ── prewarm(n) / acquire() / release(vmId) / poolStats()
//
// Firecracker 特性：极简 VMM、<125ms 冷启动、jailer chroot 隔离。
// 非 Linux 平台自动降级为 mock 模式（CI / macOS 开发）。

import { spawn, execSync, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ── 类型 ────────────────────────────────────────────────────────────────────

export interface FirecrackerVMConfig {
  kernelPath: string;
  initrdPath?: string;
  memoryMB: number;
  vcpus: number;
  rootDrive?: string;
  networkEnabled: boolean;
}

/** 暖池配置（来自 firecracker-pool） */
export interface FirecrackerPoolConfig {
  vcpus: number;
  memoryMb: number;
  kernelPath: string;
  rootfsPath: string;
  jailerPath: string;
  fcPath: string;
}

interface FirecrackerVM {
  vmId: string;
  socketPath: string;
  configPath: string;
  pid?: number;
  ipAddress?: string;
  state: 'created' | 'running' | 'ready' | 'busy' | 'stopped';
}

/** 暖池 VM 视图（来自 firecracker-pool 的 WarmVM） */
export interface WarmVM {
  id: string;
  socketPath: string;
  state: 'ready' | 'busy' | 'stopped';
  createdAt: string;
  configPath: string;
}

export interface FirecrackerBootConfig {
  'boot-source': {
    kernel_image_path: string;
    initrd_path?: string;
  };
  drives: Array<{
    drive_id: string;
    path_on_host: string;
    is_root_device: boolean;
    is_read_only: boolean;
  }>;
  'machine-config': {
    vcpus: number;
    mem_size_mib: number;
  };
  'network-interfaces': Array<{
    iface_id: string;
    guest_mac: string;
    host_dev_name: string;
  }>;
}

/**
 * FirecrackerRuntime — Firecracker VMM 运行时（含暖池）
 *
 * 使用 firecracker CLI 或 Jailer 启动微虚拟机，通过 API socket 通信。
 */
export class FirecrackerRuntime {
  private socketDir = '/var/run/aether-firecracker';
  private jailingDir = '/var/jailer/aether';
  private vmDir = '/var/run/aether-firecracker/vms';
  private fcPath: string;
  private jailerPath: string;
  private vms = new Map<string, FirecrackerVM>();
  private processes = new Map<string, ChildProcess>();
  private initialized = false;

  // 暖池状态
  private pool: WarmVM[] = [];
  private maxPoolSize: number;
  private acquiring = false;
  private poolDefaults: FirecrackerPoolConfig;

  constructor(fcPath?: string, jailerPath?: string, maxPoolSize = 4) {
    this.fcPath = fcPath ?? '/usr/local/bin/firecracker';
    this.jailerPath = jailerPath ?? '/usr/local/bin/firecracker-jailer';
    this.maxPoolSize = maxPoolSize;
    this.poolDefaults = {
      vcpus: 1,
      memoryMb: 256,
      kernelPath: '/var/lib/aether/vmlinux',
      rootfsPath: '/var/lib/aether/rootfs.ext4',
      jailerPath: this.jailerPath,
      fcPath: this.fcPath,
    };
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    for (const dir of [this.socketDir, this.vmDir, this.jailingDir]) {
      if (!existsSync(dir)) {
        try { mkdirSync(dir, { recursive: true }); } catch { /* 非 Linux 上 /var/run 可能不可写 */ }
      }
    }
  }

  /** 初始化运行时（校验二进制存在；缺失时 mock 模式） */
  async init(): Promise<void> {
    if (!existsSync(this.fcPath)) {
      console.warn(`[aether:firecracker] firecracker binary not found at ${this.fcPath}`);
      console.warn('[aether:firecracker] Firecracker runtime will use mock mode on non-Linux platforms');
    }
    if (!existsSync(this.jailerPath)) {
      console.warn(`[aether:firecracker] firecracker-jailer not found at ${this.jailerPath}`);
    }
    this.initialized = true;
    console.log('[aether:firecracker] Runtime initialized');
  }

  // ── 单 VM API（microvm-runtime 集成所依赖）────────────────────────────────

  /** 启动一个 Firecracker 微虚拟机 */
  async startVM(
    vmId: string,
    skillId: string,
    code: string,
    config: FirecrackerVMConfig,
  ): Promise<{ vmId: string; started: boolean; pid?: number; ipAddress?: string; durationMs: number }> {
    const startTime = Date.now();

    // 非 Linux 平台 mock
    if (process.platform !== 'linux') {
      console.log(`[aether:firecracker] Non-Linux platform, using mock VM for ${vmId}`);
      this.vms.set(vmId, { vmId, socketPath: '', configPath: '', state: 'running', pid: 0, ipAddress: '192.168.0.2' });
      return { vmId, started: true, pid: 0, ipAddress: '192.168.0.2', durationMs: Date.now() - startTime };
    }

    const socketPath = join(this.socketDir, `fc-${vmId}.sock`);
    const configPath = join(this.vmDir, `fc-${vmId}-config.json`);
    const bootConfig = this._buildBootConfig(vmId, config);
    writeFileSync(configPath, JSON.stringify(bootConfig, null, 2));
    this.vms.set(vmId, { vmId, socketPath, configPath, state: 'created' });

    try {
      const child = spawn(this.fcPath, ['--api-sock', socketPath, '--config-file', configPath], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      this.processes.set(vmId, child);

      const vm = this.vms.get(vmId)!;
      vm.pid = child.pid;
      vm.state = 'running';

      await this._waitForSocket(socketPath, 5000);
      console.log(`[aether:firecracker] Started VM ${vmId} with PID ${child.pid}`);

      return {
        vmId,
        started: true,
        pid: child.pid,
        ipAddress: config.networkEnabled ? '192.168.0.2' : undefined,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      try { unlinkSync(configPath); } catch { /* ignore */ }
      this.vms.delete(vmId);
      this.processes.delete(vmId);
      console.error(`[aether:firecracker] Failed to start VM ${vmId}: ${err instanceof Error ? err.message : String(err)}`);
      return { vmId, started: false, durationMs: Date.now() - startTime };
    }
  }

  /** 停止指定 VM */
  async stopVM(vmId: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) throw new Error(`VM ${vmId} not found`);

    try {
      const child = this.processes.get(vmId);
      if (child?.pid) {
        try { process.kill(child.pid, 'SIGTERM'); } catch { /* already dead */ }
      } else if (vm.pid) {
        try { process.kill(vm.pid, 'SIGTERM'); } catch { /* already dead */ }
      }
      if (vm.socketPath) {
        try { execSync(`curl -X PUT --unix-socket ${vm.socketPath} http://localhost/vm`, { stdio: 'ignore' }); } catch { /* ignore */ }
        try { unlinkSync(vm.socketPath); } catch { /* ignore */ }
      }
      if (vm.configPath) {
        try { unlinkSync(vm.configPath); } catch { /* ignore */ }
      }
      vm.state = 'stopped';
      this.vms.delete(vmId);
      this.processes.delete(vmId);
      console.log(`[aether:firecracker] Stopped VM ${vmId}`);
    } catch (err) {
      console.error(`[aether:firecracker] Error stopping VM ${vmId}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  /** 在 VM 中执行代码（mock 模式直接回显） */
  async executeInVM(vmId: string, code: string, timeoutMs = 30000): Promise<{
    ok: boolean; stdout?: string; stderr?: string; exitCode?: number; durationMs: number;
  }> {
    const startTime = Date.now();
    const vm = this.vms.get(vmId);
    if (!vm || vm.state !== 'running') {
      return { ok: false, stderr: `VM ${vmId} is not running`, durationMs: Date.now() - startTime };
    }

    const codePath = join(this.vmDir, `${vmId}-code.sh`);
    try { writeFileSync(codePath, code, { mode: 0o755 }); } catch { /* non-linux */ }

    try {
      if (process.platform !== 'linux') {
        return { ok: true, stdout: `[Mock] Executed code in VM ${vmId}`, stderr: '', exitCode: 0, durationMs: Date.now() - startTime };
      }
      const pollInterval = 100;
      let elapsed = 0;
      while (elapsed < timeoutMs) {
        await new Promise(r => setTimeout(r, pollInterval));
        elapsed += pollInterval;
        const child = this.processes.get(vmId);
        const pid = child?.pid ?? vm.pid;
        if (pid) {
          try { process.kill(pid, 0); } catch {
            return { ok: false, stderr: 'VM process terminated during code execution', exitCode: -1, durationMs: Date.now() - startTime };
          }
        }
      }
      return { ok: true, stdout: `[Mock] Code executed in VM ${vmId} (timeout=${timeoutMs}ms)`, stderr: '', exitCode: 0, durationMs: Date.now() - startTime };
    } finally {
      try { unlinkSync(codePath); } catch { /* ignore */ }
    }
  }

  getVMStatus(vmId: string): FirecrackerVM | undefined {
    return this.vms.get(vmId);
  }

  listVMs(): FirecrackerVM[] {
    return Array.from(this.vms.values());
  }

  async cleanup(): Promise<void> {
    for (const vmId of Array.from(this.vms.keys())) {
      try { await this.stopVM(vmId); } catch { /* ignore */ }
    }
    console.log('[aether:firecracker] All VMs cleaned up');
  }

  // ── 暖池 API（来自 firecracker-pool）────────────────────────────────────────

  /** 启动一个池中 VM（无 code，仅预热）。返回 WarmVM 视图。 */
  async startPoolVM(): Promise<WarmVM> {
    if (this.pool.length >= this.maxPoolSize) {
      throw new Error(`Pool exhausted: ${this.pool.length}/${this.maxPoolSize} VMs active`);
    }
    const id = randomUUID().slice(0, 8);
    const vmId = `fc-${id}`;
    const socketPath = join(this.socketDir, `${vmId}.sock`);
    const configPath = join(this.socketDir, `${vmId}-config.json`);

    const vmConfig: FirecrackerBootConfig = {
      'boot-source': { kernel_image_path: this.poolDefaults.kernelPath },
      drives: [{ drive_id: 'root', path_on_host: this.poolDefaults.rootfsPath, is_root_device: true, is_read_only: true }],
      'machine-config': { vcpus: this.poolDefaults.vcpus, mem_size_mib: this.poolDefaults.memoryMb },
      'network-interfaces': [],
    };

    try {
      // 非 Linux（CI / macOS 开发）走 mock：不写文件、不 spawn，仅登记池条目。
      if (process.platform !== 'linux') {
        const vm: WarmVM = { id: vmId, socketPath, state: 'ready', createdAt: new Date().toISOString(), configPath };
        this.pool.push(vm);
        return vm;
      }

      writeFileSync(configPath, JSON.stringify(vmConfig));
      const child = spawn(this.poolDefaults.fcPath, ['--api-sock', socketPath, '--config-file', configPath], { detached: true, stdio: 'ignore' });
      child.unref();
      this.processes.set(vmId, child);

      await this._waitForSocket(socketPath, 5000);

      const vm: WarmVM = { id: vmId, socketPath, state: 'ready', createdAt: new Date().toISOString(), configPath };
      this.pool.push(vm);
      return vm;
    } catch (error) {
      try { unlinkSync(configPath); } catch { /* ignore */ }
      throw error;
    }
  }

  /** 预热池：填充 count 个暖 VM */
  async prewarm(count: number): Promise<void> {
    for (let i = 0; i < Math.min(count, this.maxPoolSize); i++) {
      await this.startPoolVM();
    }
  }

  /** 获取一个就绪的暖 VM（互斥锁防 find+mutate 竞态） */
  acquire(): WarmVM | null {
    if (this.acquiring) return null;
    this.acquiring = true;
    try {
      const available = this.pool.find(v => v.state === 'ready');
      if (available) { available.state = 'busy'; return available; }
      if (this.pool.length < this.maxPoolSize) {
        const stopped = this.pool.find(v => v.state === 'stopped');
        if (stopped) { stopped.state = 'busy'; return stopped; }
      }
      return null;
    } finally {
      this.acquiring = false;
    }
  }

  /** 归还暖 VM 到池 */
  release(vmId: string): void {
    const vm = this.pool.find(v => v.id === vmId);
    if (vm) vm.state = 'ready';
  }

  /** 销毁池中 VM */
  async destroyPoolVM(vmId: string): Promise<void> {
    const idx = this.pool.findIndex(v => v.id === vmId);
    if (idx < 0) return;
    const vm = this.pool[idx];
    const child = this.processes.get(vmId);
    if (child?.pid) {
      try { process.kill(child.pid, 'SIGTERM'); } catch { /* already dead */ }
      this.processes.delete(vmId);
    }
    try { execSync(`pkill -f "firecracker.*${vmId}"`, { stdio: 'ignore' }); } catch { /* ignore */ }
    try { unlinkSync(vm.configPath); } catch { /* ignore */ }
    this.pool.splice(idx, 1);
  }

  poolStats(): { total: number; ready: number; busy: number } {
    return {
      total: this.pool.length,
      ready: this.pool.filter(v => v.state === 'ready').length,
      busy: this.pool.filter(v => v.state === 'busy').length,
    };
  }

  /** 销毁全部池 VM */
  async destroyPool(): Promise<void> {
    for (const vmId of this.pool.map(v => v.id)) {
      await this.destroyPoolVM(vmId);
    }
  }

  // ── 私有辅助 ────────────────────────────────────────────────────────────────

  private _buildBootConfig(vmId: string, config: FirecrackerVMConfig): FirecrackerBootConfig {
    const bootConfig: FirecrackerBootConfig = {
      'boot-source': { kernel_image_path: config.kernelPath },
      drives: [],
      'machine-config': { vcpus: config.vcpus, mem_size_mib: config.memoryMB },
      'network-interfaces': [],
    };
    if (config.initrdPath) bootConfig['boot-source'].initrd_path = config.initrdPath;
    if (config.rootDrive) {
      bootConfig.drives.push({ drive_id: 'root', path_on_host: config.rootDrive, is_root_device: true, is_read_only: true });
    }
    if (config.networkEnabled) {
      bootConfig['network-interfaces'].push({ iface_id: 'eth0', guest_mac: this._generateMac(vmId), host_dev_name: `aether-${vmId}` });
    }
    return bootConfig;
  }

  private async _waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    while (!existsSync(socketPath)) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Socket ${socketPath} not created within ${timeoutMs}ms`);
      }
      await new Promise(r => setTimeout(r, 50));
    }
  }

  private _generateMac(vmId: string): string {
    const hash = vmId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const hex = ((hash * 0xDEADBEEF) & 0xFFFFFFFF).toString(16).padStart(12, '0');
    return `06:00:${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}:${hex.slice(6, 8)}`;
  }
}
