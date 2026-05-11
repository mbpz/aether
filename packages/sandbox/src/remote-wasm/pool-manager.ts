import { RemoteWasmClient } from './client.js';
import { randomUUID } from 'crypto';

export interface PoolVM {
  id: string;
  client: RemoteWasmClient;
  state: 'warm' | 'busy' | 'cold';
  poolSize: number;
  lastUsed: string;
}

export class PreWarmedPoolManager {
  private pool: PoolVM[] = [];
  private endpointTemplate: string;
  private desiredSize: number;

  constructor(endpointTemplate: string, desiredSize = 4) {
    this.endpointTemplate = endpointTemplate;
    this.desiredSize = desiredSize;
  }

  /**
   * Initialize the pool with warm VMs.
   */
  async init(): Promise<void> {
    for (let i = 0; i < this.desiredSize; i++) {
      await this.addVM();
    }
    console.log(`[aether:wasm-pool] Initialized with ${this.pool.length} warm VMs`);
  }

  /**
   * Add a VM to the pool.
   */
  async addVM(): Promise<PoolVM> {
    const id = randomUUID().slice(0, 8);
    const endpoint = this.endpointTemplate.replace('{vmId}', id);
    const client = new RemoteWasmClient(endpoint);

    // Verify VM is healthy
    const ok = await client.health();
    if (!ok) {
      throw new Error(`VM ${id} health check failed during pool initialization`);
    }

    const vm: PoolVM = { id, client, state: 'warm', poolSize: this.pool.length + 1, lastUsed: new Date().toISOString() };
    this.pool.push(vm);
    return vm;
  }

  /**
   * Acquire a warm VM from the pool.
   */
  acquire(): PoolVM | null {
    const warm = this.pool.find(v => v.state === 'warm');
    if (warm) {
      warm.state = 'busy';
      warm.lastUsed = new Date().toISOString();
      return warm;
    }
    return null;
  }

  /**
   * Return a VM to the pool.
   */
  release(vmId: string): void {
    const vm = this.pool.find(v => v.id === vmId);
    if (vm) vm.state = 'warm';
  }

  stats(): { total: number; warm: number; busy: number } {
    return {
      total: this.pool.length,
      warm: this.pool.filter(v => v.state === 'warm').length,
      busy: this.pool.filter(v => v.state === 'busy').length,
    };
  }
}
