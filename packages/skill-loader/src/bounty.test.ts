// BountyManager contract tests — B8.5 retro-fit.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BountyManager } from './bounty.js';

describe('BountyManager', () => {
  let workdir: string;
  let mgr: BountyManager;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'aether-bounty-'));
    mgr = new BountyManager(workdir);
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  describe('createBounty', () => {
    it('creates a bounty with a unique id and open status', () => {
      const b = mgr.createBounty({
        title: 'add CSV export',
        description: 'csv support',
        reward: 100,
        createdBy: 'alice',
        category: 'productivity',
      });
      expect(b.id).toBeDefined();
      expect(b.status).toBe('open');
      expect(b.title).toBe('add CSV export');
      expect(b.reward).toBe(100);
    });

    it('lists the bounty after creation', () => {
      mgr.createBounty({ title: 'a', description: 'd', reward: 10, createdBy: 'alice', category: 'x' });
      mgr.createBounty({ title: 'b', description: 'd', reward: 20, createdBy: 'bob', category: 'y' });
      expect(mgr.listBounties().length).toBe(2);
    });

    it('getBounty returns the matching bounty by id', () => {
      const b = mgr.createBounty({ title: 'a', description: 'd', reward: 10, createdBy: 'alice', category: 'x' });
      expect(mgr.getBounty(b.id)?.id).toBe(b.id);
    });

    it('getBounty returns null for unknown id', () => {
      expect(mgr.getBounty('nope')).toBeNull();
    });
  });

  describe('submitSkill', () => {
    it('appends a submission id to the bounty', () => {
      const b = mgr.createBounty({ title: 'a', description: 'd', reward: 10, createdBy: 'alice', category: 'x' });
      const sub = mgr.submitSkill(b.id, '/path/to/skill.md', 'csv export', 'bob');
      const got = mgr.getBounty(b.id);
      expect(got?.submissions.length).toBe(1);
      // bounty.submissions is an array of submission ids; the full
      // record is retrieved via the manager's submissions map (private).
      expect(got?.submissions[0]).toBe(sub.id);
      expect(sub.skillPath).toBe('/path/to/skill.md');
      expect(sub.submittedBy).toBe('bob');
    });
  });

  describe('listBounties filters', () => {
    it('filters by status', () => {
      const b1 = mgr.createBounty({ title: 'a', description: 'd', reward: 10, createdBy: 'alice', category: 'x' });
      mgr.createBounty({ title: 'b', description: 'd', reward: 20, createdBy: 'bob', category: 'y' });
      // No public close method; just assert the open filter works.
      const open = mgr.listBounties({ status: 'open' });
      expect(open.length).toBe(2);
      expect(b1.status).toBe('open');
    });

    it('filters by category', () => {
      mgr.createBounty({ title: 'a', description: 'd', reward: 10, createdBy: 'alice', category: 'csv' });
      mgr.createBounty({ title: 'b', description: 'd', reward: 20, createdBy: 'bob', category: 'pdf' });
      expect(mgr.listBounties({ category: 'csv' }).length).toBe(1);
    });
  });

  describe('persistence', () => {
    it('persists bounties and reloads on new instance', () => {
      const b = mgr.createBounty({ title: 'persist', description: 'd', reward: 10, createdBy: 'alice', category: 'x' });
      const mgr2 = new BountyManager(workdir);
      const got = mgr2.getBounty(b.id);
      expect(got).not.toBeNull();
      expect(got!.title).toBe('persist');
    });
  });
});