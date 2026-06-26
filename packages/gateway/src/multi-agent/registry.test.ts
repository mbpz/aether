// AgentRegistry contract tests — B8.2.
import { describe, it, expect } from 'vitest';
import { AgentRegistry } from './registry.js';

describe('AgentRegistry', () => {
  describe('register + get + list', () => {
    it('register assigns an id when none provided', () => {
      const r = new AgentRegistry();
      const a = r.register({ name: 'alice', role: 'planner' });
      expect(a.id).toBeDefined();
      expect(a.name).toBe('alice');
      expect(a.role).toBe('planner');
      expect(a.status).toBe('idle');
      expect(a.capabilities).toEqual([]);
    });

    it('register preserves id when provided and updates existing record', () => {
      const r = new AgentRegistry();
      const a1 = r.register({ id: 'agent-1', name: 'alice', role: 'planner' });
      const a2 = r.register({ id: 'agent-1', name: 'alice-2', role: 'planner' });
      expect(a2.id).toBe('agent-1');
      expect(a2.name).toBe('alice-2');
      // registeredAt preserved across update.
      expect(a2.registeredAt).toBe(a1.registeredAt);
    });

    it('list returns all registered agents', () => {
      const r = new AgentRegistry();
      r.register({ name: 'a', role: 'x' });
      r.register({ name: 'b', role: 'x' });
      expect(r.list().length).toBe(2);
    });

    it('get returns undefined for unknown id', () => {
      const r = new AgentRegistry();
      expect(r.get('nope')).toBeUndefined();
    });
  });

  describe('unregister', () => {
    it('removes an existing agent and returns true', () => {
      const r = new AgentRegistry();
      r.register({ id: 'a', name: 'a', role: 'x' });
      expect(r.unregister('a')).toBe(true);
      expect(r.get('a')).toBeUndefined();
    });

    it('returns false for unknown id', () => {
      const r = new AgentRegistry();
      expect(r.unregister('nope')).toBe(false);
    });
  });

  describe('heartbeat', () => {
    it('updates lastSeen and returns true for existing agent', () => {
      const r = new AgentRegistry();
      r.register({ id: 'a', name: 'a', role: 'x' });
      const before = r.get('a')!.lastSeen;
      // Sleep to ensure timestamp changes (ISO ms precision).
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const ok = r.heartbeat('a', 'busy');
          expect(ok).toBe(true);
          const after = r.get('a')!;
          expect(after.lastSeen).not.toBe(before);
          expect(after.status).toBe('busy');
          resolve();
        }, 10);
      });
    });

    it('returns false for unknown agent', () => {
      const r = new AgentRegistry();
      expect(r.heartbeat('nope')).toBe(false);
    });
  });

  describe('find / findByCapability', () => {
    it('find returns agents matching role', () => {
      const r = new AgentRegistry();
      r.register({ name: 'a', role: 'planner' });
      r.register({ name: 'b', role: 'planner' });
      r.register({ name: 'c', role: 'executor' });
      expect(r.find('planner').length).toBe(2);
      expect(r.find('executor').length).toBe(1);
      expect(r.find('nonexistent').length).toBe(0);
    });

    it('findByCapability matches against capabilities array', () => {
      const r = new AgentRegistry();
      r.register({ name: 'a', role: 'executor', capabilities: ['python', 'rust'] });
      r.register({ name: 'b', role: 'executor', capabilities: ['go'] });
      const matches = r.findByCapability('rust');
      expect(matches.length).toBe(1);
      expect(matches[0].name).toBe('a');
    });
  });

  describe('pruneOffline', () => {
    it('marks agents offline when their lastSeen is older than ttl', () => {
      const r = new AgentRegistry();
      const fresh = r.register({ name: 'fresh', role: 'x' });
      const stale = r.register({ name: 'stale', role: 'x' });
      // Manually rewrite lastSeen on 'stale' to be old.
      const oldIso = new Date(Date.now() - 10_000).toISOString();
      (stale as { lastSeen: string }).lastSeen = oldIso;
      (fresh as { lastSeen: string }).lastSeen = new Date().toISOString();

      const pruned = r.pruneOffline(5_000);
      expect(pruned).toBe(1);
      // The agent is NOT removed (current implementation marks offline
      // but keeps the record). This documents the contract.
      expect(r.get(stale.id)?.status).toBe('offline');
      expect(r.get(fresh.id)?.status).toBe('idle');
    });

    it('returns 0 when nothing is stale', () => {
      const r = new AgentRegistry();
      r.register({ name: 'fresh', role: 'x' });
      expect(r.pruneOffline(60_000)).toBe(0);
    });
  });
});