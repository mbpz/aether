// ReviewWorkflow contract tests — B8.5 retro-fit.
// Tests the state machine: submit → assign → start → comment → approve/reject.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ReviewWorkflow } from './review-workflow.js';

describe('ReviewWorkflow', () => {
  let workdir: string;
  let wf: ReviewWorkflow;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'aether-review-'));
    wf = new ReviewWorkflow(workdir);
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  describe('submitForReview', () => {
    it('creates a pending submission with security score', async () => {
      const s = await wf.submitForReview('skill-1', 'console.log("hi")', 'alice');
      expect(s.id).toBeDefined();
      expect(s.skillId).toBe('skill-1');
      expect(s.submittedBy).toBe('alice');
      expect(s.status).toBe('pending');
      expect(s.securityScore).toBeDefined();
      expect(s.reviewHistory).toEqual([]);
    });

    it('appends to the list()', async () => {
      await wf.submitForReview('a', 'code', 'alice');
      await wf.submitForReview('b', 'code', 'bob');
      expect(wf.list().length).toBe(2);
    });

    it('getById returns the matching submission', async () => {
      const s = await wf.submitForReview('skill-2', 'code', 'alice');
      const got = wf.getById(s.id);
      expect(got?.id).toBe(s.id);
    });

    it('getById returns null for unknown id', () => {
      expect(wf.getById('nope')).toBeNull();
    });
  });

  describe('state transitions', () => {
    it('assignReviewer stores reviewerId and adds a history entry', async () => {
      const s = await wf.submitForReview('skill-3', 'code', 'alice');
      wf.assignReviewer(s.id, 'reviewer-1');
      const got = wf.getById(s.id)!;
      expect(got.reviewerId).toBe('reviewer-1');
      expect(got.reviewHistory.length).toBe(1);
    });

    it('startReview moves pending → in_review', async () => {
      const s = await wf.submitForReview('skill-4', 'code', 'alice');
      wf.assignReviewer(s.id, 'reviewer-1');
      wf.startReview(s.id);
      expect(wf.getById(s.id)?.status).toBe('in_review');
    });

    it('addComment appends a comment to reviewHistory', async () => {
      const s = await wf.submitForReview('skill-5', 'code', 'alice');
      wf.assignReviewer(s.id, 'reviewer-1');                // +1 history entry
      wf.startReview(s.id);                                  // no history
      wf.addComment(s.id, 'reviewer-1', 'looks good');      // +1
      wf.addComment(s.id, 'reviewer-1', 'second pass');     // +1
      const got = wf.getById(s.id)!;
      // 1 assign + 1 startReview + 2 comments = 4 history entries
      // (startReview itself adds a 'Review started' history entry)
      expect(got.reviewHistory.length).toBe(4);
      expect(got.reviewHistory[2].comment).toBe('looks good');
      expect(got.reviewHistory[3].comment).toBe('second pass');
    });

    it('approve moves status=approved', async () => {
      const s = await wf.submitForReview('skill-6', 'code', 'alice');
      wf.assignReviewer(s.id, 'reviewer-1');
      wf.startReview(s.id);
      wf.approve(s.id, 'reviewer-1');
      expect(wf.getById(s.id)?.status).toBe('approved');
    });

    it('reject moves status=rejected', async () => {
      const s = await wf.submitForReview('skill-7', 'code', 'alice');
      wf.assignReviewer(s.id, 'reviewer-1');
      wf.startReview(s.id);
      wf.reject(s.id, 'reviewer-1');
      expect(wf.getById(s.id)?.status).toBe('rejected');
    });

    it('requestChanges moves status=changes_requested', async () => {
      const s = await wf.submitForReview('skill-8', 'code', 'alice');
      wf.assignReviewer(s.id, 'reviewer-1');
      wf.startReview(s.id);
      wf.requestChanges(s.id, 'reviewer-1', 'add tests');
      expect(wf.getById(s.id)?.status).toBe('changes_requested');
    });
  });

  describe('queries', () => {
    it('getSubmissionsByStatus returns matching entries', async () => {
      const s1 = await wf.submitForReview('a', 'c', 'alice');
      await wf.submitForReview('b', 'c', 'bob');
      wf.assignReviewer(s1.id, 'reviewer-1');
      wf.startReview(s1.id);
      wf.approve(s1.id, 'reviewer-1');
      const approved = wf.getSubmissionsByStatus('approved');
      expect(approved.length).toBe(1);
      expect(approved[0].skillId).toBe('a');
    });

    it('getSubmissionsByReviewer returns entries assigned to that reviewer', async () => {
      const s = await wf.submitForReview('a', 'c', 'alice');
      wf.assignReviewer(s.id, 'reviewer-x');
      const got = wf.getSubmissionsByReviewer('reviewer-x');
      expect(got.length).toBe(1);
      expect(got[0].reviewerId).toBe('reviewer-x');
    });
  });

  describe('persistence', () => {
    it('persists submissions to disk and reloads on new instance', async () => {
      const s = await wf.submitForReview('skill-persist', 'c', 'alice');
      const wf2 = new ReviewWorkflow(workdir);
      const got = wf2.getById(s.id);
      expect(got).not.toBeNull();
      expect(got!.skillId).toBe('skill-persist');
    });
  });
});