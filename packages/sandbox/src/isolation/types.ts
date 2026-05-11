export type IsolationTier = 'firecracker' | 'kata' | 'gvisor';

export interface TierConfig {
  tier: IsolationTier;
  maxMemoryMb: number;
  maxCpu: number;
  blockNetwork: boolean;
  readonlyRootfs: boolean;
}

export const TIER_CONFIGS: Record<IsolationTier, TierConfig> = {
  firecracker: { tier: 'firecracker', maxMemoryMb: 512, maxCpu: 1, blockNetwork: false, readonlyRootfs: true },
  kata: { tier: 'kata', maxMemoryMb: 1024, maxCpu: 2, blockNetwork: true, readonlyRootfs: true },
  gvisor: { tier: 'gvisor', maxMemoryMb: 2048, maxCpu: 4, blockNetwork: false, readonlyRootfs: true },
};

export function selectTier(trustScore: number): IsolationTier {
  if (trustScore < 50) return 'firecracker';
  if (trustScore < 70) return 'kata';
  return 'gvisor';
}