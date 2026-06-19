// Community Plugin Review Workflow - 社区插件审核流程
// Phase 3: 社区插件审核流程 (T-015)
// Provides submission, review, and approval workflow for community plugins

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { safeJsonParse } from './parser/safe-json.js';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SecurityScorer, SecurityScore } from './audit/security-scorer.js';
import type { ScorerConfig } from './audit/security-scorer.js';

// ============================================================================
// Types
// ============================================================================

export type ReviewStatus = 'pending' | 'in_review' | 'changes_requested' | 'approved' | 'rejected';

export interface ReviewComment {
  id: string;
  reviewerId: string;
  comment: string;
  createdAt: string;
}

export interface ReviewSubmission {
  id: string;
  skillId: string;
  submittedBy: string;
  submittedAt: string;
  status: ReviewStatus;
  reviewerId?: string;
  securityScore?: SecurityScore;
  reviewHistory: ReviewComment[];
}

// ============================================================================
// Errors
// ============================================================================

export class ReviewWorkflowError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'INVALID_STATE' | 'PERSISTENCE_ERROR' | 'SECURITY_SCAN_FAILED',
  ) {
    super(message);
    this.name = 'ReviewWorkflowError';
  }
}

// ============================================================================
// Review Workflow Class
// ============================================================================

export class ReviewWorkflow {
  private submissions: Map<string, ReviewSubmission> = new Map();
  private dataDir: string;
  private scorer: SecurityScorer;

  /**
   * Create a review workflow instance
   * @param dataDir - Data storage directory (default: runtime/review/)
   */
  constructor(dataDir = 'runtime/review/') {
    this.dataDir = dataDir;
    this.scorer = new SecurityScorer();
    this._ensureDataDir();
    this._loadPersistedData();
  }

  private _ensureDataDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private _loadPersistedData(): void {
    const submissionsPath = join(this.dataDir, 'submissions.jsonl');

    if (existsSync(submissionsPath)) {
      try {
        const content = readFileSync(submissionsPath, 'utf-8');
        const lines = content.trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const submission = safeJsonParse(line) as ReviewSubmission;
              this.submissions.set(submission.id, submission);
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      } catch (err) {
        console.warn('[aether:review] Failed to load submissions:', err);
      }
    }
  }

  private _persistSubmission(submission: ReviewSubmission): void {
    const submissionsPath = join(this.dataDir, 'submissions.jsonl');
    try {
      writeFileSync(submissionsPath, JSON.stringify(submission) + '\n', { flag: 'a' });
    } catch (err) {
      throw new ReviewWorkflowError(
        `Failed to persist submission: ${err instanceof Error ? err.message : String(err)}`,
        'PERSISTENCE_ERROR',
      );
    }
  }

  private _rewriteSubmissions(): void {
    const submissionsPath = join(this.dataDir, 'submissions.jsonl');
    try {
      const lines = Array.from(this.submissions.values())
        .map((s) => JSON.stringify(s))
        .join('\n') + '\n';
      writeFileSync(submissionsPath, lines);
    } catch (err) {
      throw new ReviewWorkflowError(
        `Failed to rewrite submissions: ${err instanceof Error ? err.message : String(err)}`,
        'PERSISTENCE_ERROR',
      );
    }
  }

  /**
   * Submit a skill for review
   * Automatically runs security scan on the skill content
   * @param skillId - Unique skill identifier
   * @param content - Skill content to scan
   * @param submittedBy - User ID who submitted
   * @param language - Programming language (default: javascript)
   * @returns The created ReviewSubmission
   */
  async submitForReview(
    skillId: string,
    content: string,
    submittedBy: string,
    language: ScorerConfig['language'] = 'javascript',
  ): Promise<ReviewSubmission> {
    // Run security scan automatically
    const securityScore = this.scorer.score({ skillId, content, language });

    const submission: ReviewSubmission = {
      id: uuidv4(),
      skillId,
      submittedBy,
      submittedAt: new Date().toISOString(),
      status: 'pending',
      securityScore,
      reviewHistory: [],
    };

    this._persistSubmission(submission);
    this.submissions.set(submission.id, submission);

    console.log(
      `[aether:review] Submitted ${skillId} for review (id=${submission.id}, security=${securityScore.overall})`,
    );

    return submission;
  }

  /**
   * Assign a reviewer to a submission
   * @param submissionId - Submission ID
   * @param reviewerId - Reviewer user ID
   */
  assignReviewer(submissionId: string, reviewerId: string): void {
    const submission = this.submissions.get(submissionId);
    if (!submission) {
      throw new ReviewWorkflowError(`Submission not found: ${submissionId}`, 'NOT_FOUND');
    }

    if (submission.status !== 'pending') {
      throw new ReviewWorkflowError(
        `Cannot assign reviewer to submission in status: ${submission.status}`,
        'INVALID_STATE',
      );
    }

    submission.reviewerId = reviewerId;
    submission.reviewHistory.push({
      id: uuidv4(),
      reviewerId,
      comment: `Reviewer ${reviewerId} assigned`,
      createdAt: new Date().toISOString(),
    });

    this._rewriteSubmissions();
    console.log(`[aether:review] Assigned reviewer ${reviewerId} to submission ${submissionId}`);
  }

  /**
   * Start the review process for a submission
   * @param submissionId - Submission ID
   */
  startReview(submissionId: string): void {
    const submission = this.submissions.get(submissionId);
    if (!submission) {
      throw new ReviewWorkflowError(`Submission not found: ${submissionId}`, 'NOT_FOUND');
    }

    if (!submission.reviewerId) {
      throw new ReviewWorkflowError('Cannot start review without assigned reviewer', 'INVALID_STATE');
    }

    if (submission.status !== 'pending') {
      throw new ReviewWorkflowError(
        `Cannot start review for submission in status: ${submission.status}`,
        'INVALID_STATE',
      );
    }

    submission.status = 'in_review';
    submission.reviewHistory.push({
      id: uuidv4(),
      reviewerId: submission.reviewerId,
      comment: 'Review started',
      createdAt: new Date().toISOString(),
    });

    this._rewriteSubmissions();
    console.log(`[aether:review] Started review for submission ${submissionId}`);
  }

  /**
   * Add a comment to a submission
   * @param submissionId - Submission ID
   * @param reviewerId - Reviewer user ID
   * @param comment - Comment text
   */
  addComment(submissionId: string, reviewerId: string, comment: string): void {
    const submission = this.submissions.get(submissionId);
    if (!submission) {
      throw new ReviewWorkflowError(`Submission not found: ${submissionId}`, 'NOT_FOUND');
    }

    if (submission.reviewerId !== reviewerId) {
      throw new ReviewWorkflowError('Only assigned reviewer can add comments', 'INVALID_STATE');
    }

    submission.reviewHistory.push({
      id: uuidv4(),
      reviewerId,
      comment,
      createdAt: new Date().toISOString(),
    });

    this._rewriteSubmissions();
    console.log(`[aether:review] Added comment to submission ${submissionId}`);
  }

  /**
   * Request changes for a submission
   * @param submissionId - Submission ID
   * @param reviewerId - Reviewer user ID
   * @param feedback - Change request feedback
   */
  requestChanges(submissionId: string, reviewerId: string, feedback: string): void {
    const submission = this.submissions.get(submissionId);
    if (!submission) {
      throw new ReviewWorkflowError(`Submission not found: ${submissionId}`, 'NOT_FOUND');
    }

    if (submission.reviewerId !== reviewerId) {
      throw new ReviewWorkflowError('Only assigned reviewer can request changes', 'INVALID_STATE');
    }

    if (submission.status !== 'in_review' && submission.status !== 'changes_requested') {
      throw new ReviewWorkflowError(
        `Cannot request changes for submission in status: ${submission.status}`,
        'INVALID_STATE',
      );
    }

    submission.status = 'changes_requested';
    submission.reviewHistory.push({
      id: uuidv4(),
      reviewerId,
      comment: `Changes requested: ${feedback}`,
      createdAt: new Date().toISOString(),
    });

    this._rewriteSubmissions();
    console.log(`[aether:review] Requested changes for submission ${submissionId}`);
  }

  /**
   * Approve a submission
   * @param submissionId - Submission ID
   * @param reviewerId - Reviewer user ID
   */
  approve(submissionId: string, reviewerId: string): void {
    const submission = this.submissions.get(submissionId);
    if (!submission) {
      throw new ReviewWorkflowError(`Submission not found: ${submissionId}`, 'NOT_FOUND');
    }

    if (submission.reviewerId !== reviewerId) {
      throw new ReviewWorkflowError('Only assigned reviewer can approve', 'INVALID_STATE');
    }

    if (submission.status !== 'in_review') {
      throw new ReviewWorkflowError(
        `Cannot approve submission in status: ${submission.status}`,
        'INVALID_STATE',
      );
    }

    submission.status = 'approved';
    submission.reviewHistory.push({
      id: uuidv4(),
      reviewerId,
      comment: 'Submission approved',
      createdAt: new Date().toISOString(),
    });

    this._rewriteSubmissions();
    console.log(`[aether:review] Approved submission ${submissionId}`);
  }

  /**
   * Reject a submission
   * @param submissionId - Submission ID
   * @param reviewerId - Reviewer user ID
   */
  reject(submissionId: string, reviewerId: string): void {
    const submission = this.submissions.get(submissionId);
    if (!submission) {
      throw new ReviewWorkflowError(`Submission not found: ${submissionId}`, 'NOT_FOUND');
    }

    if (submission.reviewerId !== reviewerId) {
      throw new ReviewWorkflowError('Only assigned reviewer can reject', 'INVALID_STATE');
    }

    if (submission.status !== 'in_review') {
      throw new ReviewWorkflowError(
        `Cannot reject submission in status: ${submission.status}`,
        'INVALID_STATE',
      );
    }

    submission.status = 'rejected';
    submission.reviewHistory.push({
      id: uuidv4(),
      reviewerId,
      comment: 'Submission rejected',
      createdAt: new Date().toISOString(),
    });

    this._rewriteSubmissions();
    console.log(`[aether:review] Rejected submission ${submissionId}`);
  }

  /**
   * Get all submissions assigned to a specific reviewer
   * @param reviewerId - Reviewer user ID
   * @returns Array of submissions
   */
  getSubmissionsByReviewer(reviewerId: string): ReviewSubmission[] {
    return Array.from(this.submissions.values()).filter(
      (s) => s.reviewerId === reviewerId,
    );
  }

  /**
   * Get all submissions with a specific status
   * @param status - Review status to filter by
   * @returns Array of submissions
   */
  getSubmissionsByStatus(status: ReviewStatus): ReviewSubmission[] {
    return Array.from(this.submissions.values()).filter(
      (s) => s.status === status,
    );
  }

  /**
   * Get a submission by ID
   * @param submissionId - Submission ID
   * @returns Submission or null
   */
  getById(submissionId: string): ReviewSubmission | null {
    return this.submissions.get(submissionId) ?? null;
  }

  /**
   * List all submissions
   * @returns Array of all submissions
   */
  list(): ReviewSubmission[] {
    return Array.from(this.submissions.values());
  }
}
