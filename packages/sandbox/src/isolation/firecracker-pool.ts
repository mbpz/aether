// packages/sandbox/src/isolation/firecracker-pool.ts

import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface FirecrackerConfig {
  vcpus: number;
  memoryMb: number;
  kernelPath: string;
  rootfsPath: string;
  jailerPath: string;
}

export interface WarmVM {
  id: string;
  socketPath: string;
  state: 'ready' | 'busy' | 'stopped';
  createdAt: string;
}

export class FirecrackerPoolManager {
  private pool: WarmVM[] = [];
  private config: FirecrackerConfig;
  private socketDir: string;
  private maxPoolSize: number;

  constructor(config: Partial<FirecrackerConfig> = {}, maxPoolSize = 4) {
    this.config = {
      vcpus: config.vcpus ?? 1,
      memoryMb: config.memoryMb ?? 256,
      kernelPath: config.kernelPath ?? '/var/lib/aether/vmlinux',
      rootfsPath: config.rootfsPath ?? '/var/lib/aether/rootfs.ext4',
      jailerPath: config.jailerPath ?? '/usr/local/bin/firecracker-jailer',
    };
    this.socketDir = '/var/run/aether-firecracker';
    this.maxPoolSize = maxPoolSize;
    if (!existsSync(this.socketDir)) mkdirSync(this.socketDir, { recursive: true });
  }

  /**
   * Start a Firecracker microVM and add it to the pool.
   */
  async startVM(): Promise<WarmVM> {
    const id = randomUUID().slice(0, 8);
    const socketPath = join(this.socketDir, `fc-${id}.sock`);
    const vmId = `fc-${id}`;

    // Create VM config JSON
    const configPath = join(this.socketDir, `fc-${id}-config.json`);
    writeFileSync(configPath, JSON.stringify({
      boot-source: { kernel_image_path: this.config.kernelPath, initrd_path: '' },
      drives: [{ drive_id: 'root', path_on_host: this.config.rootfsPath, is_root_device: true, is_read_only: true }],
      machine-config: { vcpus: this.config.vcpus, mem_size_mib: this.config.memoryMb },
      network-interfaces: [],
    }));

    // Start firecracker process
    const fcPath = '/usr/local/bin/firecracker';
    const args = ['--api-sock', socketPath, '--config-file', configPath];
    spawn(fcPath, args, { detached: true, stdio: 'ignore' });

    const vm: WarmVM = { id: vmId, socketPath, state: 'ready', createdAt: new Date().toISOString() };
    this.pool.push(vm);
    return vm;
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
   */
  acquire(): WarmVM | null {
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
   */
  async destroyVM(vmId: string): Promise<void> {
    const idx = this.pool.findIndex(v => v.id === vmId);
    if (idx >= 0) {
      execSync(`pkill -f firecracker-${vmId}`, { stdio: 'ignore' });
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
}
