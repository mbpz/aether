// TaskQueue contract tests — B8.1 retro-fit. Pure logic, no IO.
import { describe, it, expect } from 'vitest';
import { TaskQueue } from './task-queue.js';

function makeTask(id: string) {
  return {
    id,
    operation: 'exec',
    code: 'noop',
    injectedSecrets: [],
    source: 'test',
  };
}

describe('TaskQueue', () => {
  describe('enqueue + get + list', () => {
    it('enqueues a task and sets initial status to queued', () => {
      const q = new TaskQueue();
      const t = q.enqueue(makeTask('t-1'));
      expect(t.id).toBe('t-1');
      expect(t.status).toBe('queued');
      expect(t.submittedAt).toBeDefined();
      expect(q.get('t-1')?.status).toBe('queued');
    });

    it('list returns tasks ordered by submission time (newest first)', async () => {
      const q = new TaskQueue();
      q.enqueue(makeTask('a'));
      await new Promise((r) => setTimeout(r, 5));
      q.enqueue(makeTask('b'));
      const all = q.list();
      expect(all.length).toBe(2);
      expect(all[0].id).toBe('b');
    });

    it('list respects limit', () => {
      const q = new TaskQueue();
      for (let i = 0; i < 5; i++) q.enqueue(makeTask(`t${i}`));
      expect(q.list(3).length).toBe(3);
    });
  });

  describe('state transitions', () => {
    it('markRunning transitions queued → running', () => {
      const q = new TaskQueue();
      q.enqueue(makeTask('t-1'));
      q.markRunning('t-1');
      expect(q.get('t-1')?.status).toBe('running');
      expect(q.get('t-1')?.startedAt).toBeDefined();
    });

    it('markDone with ok=true → done; ok=false → failed', () => {
      const q = new TaskQueue();
      q.enqueue(makeTask('ok-task'));
      q.markDone('ok-task', { ok: true, output: 42 });
      expect(q.get('ok-task')?.status).toBe('done');

      q.enqueue(makeTask('bad-task'));
      q.markDone('bad-task', { ok: false, error: 'broke' });
      expect(q.get('bad-task')?.status).toBe('failed');
    });

    it('markRejected sets status=rejected with reason', () => {
      const q = new TaskQueue();
      q.enqueue(makeTask('reject-me'));
      q.markRejected('reject-me', 'manifest invalid');
      const t = q.get('reject-me');
      expect(t?.status).toBe('rejected');
      expect(t?.result?.error).toBe('manifest invalid');
    });

    it('marking an unknown id is a no-op', () => {
      const q = new TaskQueue();
      expect(() => q.markRunning('not-here')).not.toThrow();
      expect(() => q.markDone('not-here', { ok: true })).not.toThrow();
      expect(() => q.markRejected('not-here', 'reason')).not.toThrow();
    });
  });

  describe('events', () => {
    it('emits enqueue, running, done events', async () => {
      const q = new TaskQueue();
      const events: string[] = [];
      q.on('enqueue', () => events.push('enqueue'));
      q.on('running', () => events.push('running'));
      q.on('done', () => events.push('done'));

      q.enqueue(makeTask('e1'));
      q.markRunning('e1');
      q.markDone('e1', { ok: true });

      await new Promise((r) => setTimeout(r, 5));
      expect(events).toEqual(['enqueue', 'running', 'done']);
    });

    it('emits rejected event on markRejected', async () => {
      const q = new TaskQueue();
      let rejectedCount = 0;
      q.on('rejected', () => rejectedCount++);
      q.enqueue(makeTask('e1'));
      q.markRejected('e1', 'bad');
      await new Promise((r) => setTimeout(r, 5));
      expect(rejectedCount).toBe(1);
    });
  });

  describe('stats', () => {
    it('reflects per-status counts', () => {
      const q = new TaskQueue();
      q.enqueue(makeTask('q1'));        // queued
      q.enqueue(makeTask('q2'));
      q.markRunning('q2');               // running
      q.enqueue(makeTask('d1'));
      q.markDone('d1', { ok: true });    // done
      q.enqueue(makeTask('f1'));
      q.markDone('f1', { ok: false });   // failed
      q.enqueue(makeTask('r1'));
      q.markRejected('r1', 'reject');    // rejected

      const s = q.stats();
      expect(s.total).toBe(5);
      expect(s.queued).toBe(1);
      expect(s.running).toBe(1);
      expect(s.done).toBe(1);
      expect(s.failed).toBe(1);
      expect(s.rejected).toBe(1);
    });
  });
});
