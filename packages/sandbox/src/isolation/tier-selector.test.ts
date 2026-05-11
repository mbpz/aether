import { describe, it, expect } from 'vitest';
import { selectTier, TIER_CONFIGS } from './tier-selector.js';

describe('selectTier', () => {
  it('returns firecracker for trustScore < 50', () => {
    expect(selectTier(0)).toBe('firecracker');
    expect(selectTier(49)).toBe('firecracker');
  });

  it('returns kata for 50 <= trustScore < 70', () => {
    expect(selectTier(50)).toBe('kata');
    expect(selectTier(69)).toBe('kata');
  });

  it('returns gvisor for trustScore >= 70', () => {
    expect(selectTier(70)).toBe('gvisor');
    expect(selectTier(100)).toBe('gvisor');
  });
});

describe('TIER_CONFIGS', () => {
  it('firecracker has readonlyRootfs', () => {
    expect(TIER_CONFIGS.firecracker.readonlyRootfs).toBe(true);
  });

  it('kata blocks network', () => {
    expect(TIER_CONFIGS.kata.blockNetwork).toBe(true);
  });

  it('gvisor allows most resources', () => {
    expect(TIER_CONFIGS.gvisor.maxMemoryMb).toBeGreaterThan(TIER_CONFIGS.kata.maxMemoryMb);
  });
});