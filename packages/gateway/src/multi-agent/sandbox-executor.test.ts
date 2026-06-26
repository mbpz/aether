// AgentSandboxExecutor + AgentSandboxManager — B8.2 retro-fit.
// We don't load isolated-vm (CI-unfriendly, per ADR-001). Test the
// surrounding Map-management contract via AgentSandboxManager and the
// dispose lifecycle of AgentSandboxExecutor.
import { describe, it, expect } from 'vitest';
import { AgentSandboxExecutor, AgentSandboxManager } from './sandbox-executor.js';

describe('AgentSandboxManager', () => {
  describe('getOrCreate', () => {
    it('creates an executor for a new agent id', () => {
      const mgr = new AgentSandboxManager();
      const exec = mgr.getOrCreate('agent-1');
      expect(exec).toBeInstanceOf(AgentSandboxExecutor);
      expect(mgr.get('agent-1')).toBe(exec);
    });

    it('returns the same executor for repeated calls', () => {
      const mgr = new AgentSandboxManager();
      const a = mgr.getOrCreate('agent-1');
      const b = mgr.getOrCreate('agent-1');
      expect(a).toBe(b);
    });

    it('returns different executors for different agent ids', () => {
      const mgr = new AgentSandboxManager();
      const a = mgr.getOrCreate('agent-1');
      const b = mgr.getOrCreate('agent-2');
      expect(a).not.toBe(b);
    });
  });

  describe('get', () => {
    it('returns undefined for unknown agent id', () => {
      const mgr = new AgentSandboxManager();
      expect(mgr.get('nope')).toBeUndefined();
    });
  });

  describe('dispose', () => {
    it('removes a single executor', () => {
      const mgr = new AgentSandboxManager();
      mgr.getOrCreate('a');
      mgr.getOrCreate('b');
      mgr.dispose('a');
      expect(mgr.get('a')).toBeUndefined();
      expect(mgr.get('b')).toBeDefined();
    });

    it('does not throw for unknown id', () => {
      const mgr = new AgentSandboxManager();
      expect(() => mgr.dispose('nope')).not.toThrow();
    });
  });

  describe('disposeAll', () => {
    it('removes all executors', () => {
      const mgr = new AgentSandboxManager();
      mgr.getOrCreate('a');
      mgr.getOrCreate('b');
      mgr.disposeAll();
      expect(mgr.get('a')).toBeUndefined();
      expect(mgr.get('b')).toBeUndefined();
    });
  });

  describe('stats', () => {
    it('returns activeExecutors count and agentIds list', () => {
      const mgr = new AgentSandboxManager();
      mgr.getOrCreate('a');
      mgr.getOrCreate('b');
      const s = mgr.stats() as { activeExecutors: number; agentIds: string[] };
      expect(s.activeExecutors).toBe(2);
      expect(s.agentIds).toContain('a');
      expect(s.agentIds).toContain('b');
    });
  });
});