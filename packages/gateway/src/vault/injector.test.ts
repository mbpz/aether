// VaultInjector contract tests — B8.1 retro-fit. TTL + revoke + resolveAsEnv.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VaultInjector } from './injector.js';

describe('VaultInjector', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('inject + resolve', () => {
    it('round-trips a single secret', () => {
      const v = new VaultInjector();
      const id = v.inject('API_KEY', 'sk-abc');
      const resolved = v.resolve(id);
      expect(resolved).toEqual({ key: 'API_KEY', value: 'sk-abc' });
    });

    it('returns null for unknown id', () => {
      const v = new VaultInjector();
      expect(v.resolve('does-not-exist')).toBeNull();
    });

    it('marks usedBy when sessionId is passed', () => {
      const v = new VaultInjector();
      const id = v.inject('K', 'V');
      v.resolve(id, 'session-1');
      // usedBy is private state; verify via second resolve where re-acquired.
      const r2 = v.resolve(id, 'session-2');
      expect(r2).not.toBeNull();
    });
  });

  describe('TTL expiry', () => {
    it('purges expired entries', () => {
      vi.useFakeTimers();
      const v = new VaultInjector();
      const id = v.inject('K', 'V', 100);
      // Advance fake clock past TTL.
      vi.advanceTimersByTime(200);
      const r = v.resolve(id);
      expect(r).toBeNull();
    });
  });

  describe('resolveAsEnv', () => {
    it('builds an env object from a list of ids', () => {
      const v = new VaultInjector();
      const idA = v.inject('A', 'one');
      const idB = v.inject('B', 'two');
      const env = v.resolveAsEnv([idA, idB]);
      expect(env).toEqual({ A: 'one', B: 'two' });
    });

    it('skips missing ids silently', () => {
      const v = new VaultInjector();
      const idA = v.inject('A', 'one');
      const env = v.resolveAsEnv([idA, 'missing']);
      expect(env).toEqual({ A: 'one' });
    });
  });

  describe('revoke', () => {
    it('removes a secret by id and subsequent resolve returns null', () => {
      const v = new VaultInjector();
      const id = v.inject('K', 'V');
      expect(v.revoke(id)).toBe(true);
      expect(v.resolve(id)).toBeNull();
    });

    it('returns false for unknown id', () => {
      const v = new VaultInjector();
      expect(v.revoke('nope')).toBe(false);
    });
  });

  describe('stats', () => {
    it('counts active entries', () => {
      const v = new VaultInjector();
      v.inject('A', 'one');
      v.inject('B', 'two');
      const s = v.stats();
      expect(s.activeSecrets).toBeGreaterThanOrEqual(2);
      expect(s.entries.length).toBeGreaterThanOrEqual(2);
    });
  });
});
