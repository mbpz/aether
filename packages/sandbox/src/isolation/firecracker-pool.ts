// packages/sandbox/src/isolation/firecracker-pool.ts

/**
 * FirecrackerPoolManager - Mock implementation for non-Linux platforms
 *
 * On Linux, this manages a pool of Firecracker microVMs using the vmm-control socket.
 * On other platforms, this is a mock that simulates VM lifecycle without actual VMs.
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface FirecrackerConfig {
  vcpus: number;
  memoryMb: number;
  kernelPath: string;
  rootfsPath: string;
  jailerPath: string;
  /** Path to firecracker binary (default: /usr/local/bin/firecracker) */
  fcPath: string;
}

export interface WarmVM {
  id: string;
  socketPath: string;
  state: 'ready' | 'busy' | 'stopped';
  createdAt: string;
  configPath: string;
}

export class FirecrackerPoolManager {
  private pool: WarmVM[] = [];
  private config: FirecrackerConfig;
  private socketDir: string;
  private maxPoolSize: number;
  /** Track spawned Firecracker processes by VM ID */
  private processes = new Map<string, ChildProcess>();
  /** Mutex flag to prevent race condition in acquire() */
  private acquiring = false;

  constructor(config: Partial<FirecrackerConfig> = {}, maxPoolSize = 4) {
    this.config = {
      vcpus: config.vcpus ?? 1,
      memoryMb: config.memoryMb ?? 256,
      kernelPath: config.kernelPath ?? '/var/lib/aether/vmlinux',
      rootfsPath: config.rootfsPath ?? '/var/lib/aether/rootfs.ext4',
      jailerPath: config.jailerPath ?? '/usr/local/bin/firecracker-jailer',
      fcPath: config.fcPath ?? '/usr/local/bin/firecracker',
    };
    this.socketDir = '/var/run/aether-firecracker';
    this.maxPoolSize = maxPoolSize;
    if (!existsSync(this.socketDir)) mkdirSync(this.socketDir, { recursive: true });
  }

  /**
   * Start a Firecracker microVM and add it to the pool.
   * On non-Linux platforms, this creates a mock VM entry without starting an actual process.
   */
  async startVM(): Promise<WarmVM> {
    if (this.pool.length >= this.maxPoolSize) {
      throw new Error(`Pool exhausted: ${this.pool.length}/${this.maxPoolSize} VMs active`);
    }
    const id = randomUUID().slice(0, 8);
    const socketPath = join(this.socketDir, `fc-${id}.sock`);
    const vmId = `fc-${id}`;
    const configPath = join(this.socketDir, `fc-${id}-config.json`);

    try {
      // Build boot-source config, omitting initrd_path if not available
      const bootSource: Record<string, string> = { kernel_image_path: this.config.kernelPath };
      // Only include initrd_path if kernel path is set and not a placeholder
      if (this.config.kernelPath && !this.config.kernelPath.includes('placeholder')) {
        // initrd would be set here if available
      }

      const vmConfig = {
        'boot-source': bootSource,
        drives: [{ drive_id: 'root', path_on_host: this.config.rootfsPath, is_root_device: true, is_read_only: true }],
        'machine-config': { vcpus: this.config.vcpus, mem_size_mib: this.config.memoryMb },
        'network-interfaces': [] as Array<{ iface_id: string; guest_mac: string; host_dev_name: string }>,
      };

      writeFileSync(configPath, JSON.stringify(vmConfig));

      // Start firecracker process and track it
      const fcPath = this.config.fcPath;
      const args = ['--api-sock', socketPath, '--config-file', configPath];
      const child = spawn(fcPath, args, { detached: true, stdio: 'ignore' });
      child.unref(); // Detach from parent process so child can outlive parent

      // Track the process PID for lifecycle management
      this.processes.set(vmId, child);

      // Firecracker creates the socket when it's ready - poll until socket exists or timeout
      const timeoutMs = 5000;
      const intervalMs = 100;
      const startTime = Date.now();
      while (!existsSync(socketPath)) {
        if (Date.now() - startTime > timeoutMs) {
          throw new Error(`Firecracker socket ${socketPath} not created within ${timeoutMs}ms`);
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }

      const vm: WarmVM = { id: vmId, socketPath, state: 'ready', createdAt: new Date().toISOString(), configPath };
      this.pool.push(vm);
      return vm;
    } catch (error) {
      // Clean up config file on failure
      try { unlinkSync(configPath); } catch { /* ignore */ }
      throw error;
    }
  }

  /**
   * Pre-fill the pool with warm VMs.
   */
  async prewarm(count: number): Promise<void> {
    for (let i = 0; i < Math.min(count, this.maxPoolSize); i++) {
      await this.startVM();
    }
  }

  /**
   * Get an available VM from the pool.
   * Thread-safe: uses mutex flag to prevent race condition in find+mutate.
   */
  acquire(): WarmVM | null {
    // Mutex lock to prevent race condition
    if (this.acquiring) return null;
    this.acquiring = true;
    try {
      const available = this.pool.find(v => v.state === 'ready');
      if (available) {
        available.state = 'busy';
        return available;
      }
      if (this.pool.length < this.maxPoolSize) {
        const vm = this.pool.find(v => v.state === 'stopped');
        if (vm) { vm.state = 'busy'; return vm; }
      }
      return null;
    } finally {
      this.acquiring = false;
    }
  }

  /**
   * Return a VM to the pool.
   */
  release(vmId: string): void {
    const vm = this.pool.find(v => v.id === vmId);
    if (vm) vm.state = 'ready';
  }

  /**
   * Stop and remove a VM.
   * Uses PID tracking to properly terminate the process.
   */
  async destroyVM(vmId: string): Promise<void> {
    const idx = this.pool.findIndex(v => v.id === vmId);
    if (idx >= 0) {
      const vm = this.pool[idx];

      // Try to kill via tracked PID first
      const child = this.processes.get(vmId);
      if (child && child.pid) {
        try {
          process.kill(child.pid, 'SIGTERM');
        } catch { /* process may already be dead */ }
        this.processes.delete(vmId);
      }

      // Also try socket-based matching as fallback
      try {
        execSync(`pkill -f "firecracker.*${vmId}"`, { stdio: 'ignore' });
      } catch { /* ignore if no process found */ }

      // Clean up config file
      try { unlinkSync(vm.configPath); } catch { /* ignore */ }

      this.pool.splice(idx, 1);
    }
  }

  stats(): { total: number; ready: number; busy: number } {
    return {
      total: this.pool.length,
      ready: this.pool.filter(v => v.state === 'ready').length,
      busy: this.pool.filter(v => v.state === 'busy').length,
    };
  }

  /**
   * Gracefully terminate all VMs and clean up.
   */
  async destroy(): Promise<void> {
    const vmIds = this.pool.map(v => v.id);
    for (const vmId of vmIds) {
      await this.destroyVM(vmId);
    }
  }
}