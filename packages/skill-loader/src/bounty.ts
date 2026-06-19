// Developer Bounty System - 开发者赏金系统
// 提供技能开发任务悬赏、提交、评审功能

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { safeJsonParse } from './parser/safe-json.js';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * BountyStatus - 赏金状态枚举
 */
export type BountyStatus = 'open' | 'closed' | 'awarded';

/**
 * SubmissionStatus - 提交状态枚举
 */
export type SubmissionStatus = 'pending' | 'accepted' | 'rejected';

/**
 * BountyCategory - 赏金类别
 */
export type BountyCategory = 'feature' | 'bugfix' | 'integration' | 'documentation' | 'security' | 'other';

/**
 * Difficulty - 难度级别
 */
export type Difficulty = 'beginner' | 'intermediate' | 'advanced' | 'expert';

/**
 * Currency - 奖励货币类型
 */
export type Currency = 'USD' | 'EUR' | 'GBP' | 'CNY' | 'tokens' | 'credits';

/**
 * Bounty - 赏金任务主体
 */
export interface Bounty {
  id: string;
  title: string;
  description: string;
  category: BountyCategory;
  difficulty: Difficulty;
  reward: number;
  currency: Currency;
  skills: string[]; // required skill paths or names
  requirements: string[]; // functional requirements
  deadline: string; // ISO date string
  createdBy: string;
  createdAt: string;
  status: BountyStatus;
  submissions: string[]; // submission IDs
  winnerId?: string; // winning submission ID
}

/**
 * BountySubmission - 赏金提交
 */
export interface BountySubmission {
  id: string;
  bountyId: string;
  submittedBy: string;
  skillPath: string; // path to submitted SKILL.md
  description: string;
  submittedAt: string;
  status: SubmissionStatus;
  reviewNotes?: string;
}

/**
 * BountyStats - 赏金统计信息
 */
export interface BountyStats {
  totalBounties: number;
  openBounties: number;
  closedBounties: number;
  awardedBounties: number;
  totalSubmissions: number;
  totalRewardValue: number;
  byCategory: Record<BountyCategory, number>;
  byDifficulty: Record<Difficulty, number>;
}

/**
 * BountyFilters - 赏金过滤选项
 */
export interface BountyFilters {
  category?: BountyCategory;
  difficulty?: Difficulty;
  status?: BountyStatus;
  skills?: string[];
  minReward?: number;
  maxReward?: number;
}

/**
 * BountyError - 赏金系统错误
 */
export class BountyError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'ALREADY_EXISTS' | 'INVALID_STATE' | 'PERSISTENCE_ERROR',
  ) {
    super(message);
    this.name = 'BountyError';
  }
}

/**
 * BountyManager - 赏金系统核心类
 * 提供赏金的创建、提交、评审和统计功能
 */
export class BountyManager {
  private bounties: Map<string, Bounty> = new Map();
  private submissions: Map<string, BountySubmission> = new Map();
  private dataDir: string;

  /**
   * 创建赏金管理器实例
   * @param dataDir - 赏金数据存储目录 (default: runtime/bounty/)
   */
  constructor(dataDir = 'runtime/bounty/') {
    this.dataDir = dataDir;
    this._ensureDataDir();
    this._loadPersistedData();
  }

  private _ensureDataDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private _loadPersistedData(): void {
    const bountiesPath = join(this.dataDir, 'bounties.jsonl');
    const submissionsPath = join(this.dataDir, 'submissions.jsonl');

    // Load bounties
    if (existsSync(bountiesPath)) {
      try {
        const content = readFileSync(bountiesPath, 'utf-8');
        const lines = content.trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const bounty = safeJsonParse(line) as Bounty;
              this.bounties.set(bounty.id, bounty);
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      } catch (err) {
        console.warn('[aether:bounty] Failed to load bounties:', err);
      }
    }

    // Load submissions
    if (existsSync(submissionsPath)) {
      try {
        const content = readFileSync(submissionsPath, 'utf-8');
        const lines = content.trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const submission = safeJsonParse(line) as BountySubmission;
              this.submissions.set(submission.id, submission);
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      } catch (err) {
        console.warn('[aether:bounty] Failed to load submissions:', err);
      }
    }
  }

  private _persistBounty(bounty: Bounty): void {
    const bountiesPath = join(this.dataDir, 'bounties.jsonl');
    try {
      writeFileSync(bountiesPath, JSON.stringify(bounty) + '\n', { flag: 'a' });
    } catch (err) {
      throw new BountyError(
        `Failed to persist bounty: ${err instanceof Error ? err.message : String(err)}`,
        'PERSISTENCE_ERROR',
      );
    }
  }

  private _persistSubmission(submission: BountySubmission): void {
    const submissionsPath = join(this.dataDir, 'submissions.jsonl');
    try {
      writeFileSync(submissionsPath, JSON.stringify(submission) + '\n', { flag: 'a' });
    } catch (err) {
      throw new BountyError(
        `Failed to persist submission: ${err instanceof Error ? err.message : String(err)}`,
        'PERSISTENCE_ERROR',
      );
    }
  }

  private _rewriteBounties(): void {
    const bountiesPath = join(this.dataDir, 'bounties.jsonl');
    try {
      const lines = Array.from(this.bounties.values())
        .map((b) => JSON.stringify(b))
        .join('\n') + '\n';
      writeFileSync(bountiesPath, lines);
    } catch (err) {
      throw new BountyError(
        `Failed to rewrite bounties: ${err instanceof Error ? err.message : String(err)}`,
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
      throw new BountyError(
        `Failed to rewrite submissions: ${err instanceof Error ? err.message : String(err)}`,
        'PERSISTENCE_ERROR',
      );
    }
  }

  /**
   * 创建新的赏金任务
   * @param data - 赏金创建数据（不含id, createdAt, status, submissions）
   * @returns 创建的赏金对象
   */
  createBounty(data: Omit<Bounty, 'id' | 'createdAt' | 'status' | 'submissions'>): Bounty {
    const now = new Date().toISOString();
    const bounty: Bounty = {
      ...data,
      id: uuidv4(),
      createdAt: now,
      status: 'open',
      submissions: [],
    };

    this._persistBounty(bounty);
    this.bounties.set(bounty.id, bounty);

    console.log(`[aether:bounty] Created bounty: ${bounty.title} (id=${bounty.id})`);
    return bounty;
  }

  /**
   * 获取所有赏金，支持可选过滤
   * @param filters - 可选的过滤条件
   * @returns 符合条件的赏金列表
   */
  listBounties(filters?: BountyFilters): Bounty[] {
    let results = Array.from(this.bounties.values());

    if (filters) {
      if (filters.category) {
        results = results.filter((b) => b.category === filters.category);
      }
      if (filters.difficulty) {
        results = results.filter((b) => b.difficulty === filters.difficulty);
      }
      if (filters.status) {
        results = results.filter((b) => b.status === filters.status);
      }
      if (filters.skills && filters.skills.length > 0) {
        results = results.filter((b) =>
          filters.skills!.some((s) => b.skills.includes(s)),
        );
      }
      if (filters.minReward !== undefined) {
        results = results.filter((b) => b.reward >= filters.minReward!);
      }
      if (filters.maxReward !== undefined) {
        results = results.filter((b) => b.reward <= filters.maxReward!);
      }
    }

    // Sort by createdAt descending
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return results;
  }

  /**
   * 根据ID获取赏金
   * @param id - 赏金ID
   * @returns 赏金对象或null
   */
  getBounty(id: string): Bounty | null {
    return this.bounties.get(id) ?? null;
  }

  /**
   * 提交技能到赏金
   * @param bountyId - 赏金ID
   * @param skillPath - 提交的技能文件路径
   * @param description - 提交描述
   * @param submittedBy - 提交者标识
   * @returns 创建的提交对象
   */
  submitSkill(
    bountyId: string,
    skillPath: string,
    description: string,
    submittedBy: string,
  ): BountySubmission {
    const bounty = this.bounties.get(bountyId);
    if (!bounty) {
      throw new BountyError(`Bounty not found: ${bountyId}`, 'NOT_FOUND');
    }
    if (bounty.status !== 'open') {
      throw new BountyError(`Bounty is not open: ${bounty.status}`, 'INVALID_STATE');
    }

    const submission: BountySubmission = {
      id: uuidv4(),
      bountyId,
      submittedBy,
      skillPath,
      description,
      submittedAt: new Date().toISOString(),
      status: 'pending',
    };

    this._persistSubmission(submission);
    this.submissions.set(submission.id, submission);

    // Update bounty submissions
    bounty.submissions.push(submission.id);
    this._rewriteBounties();

    console.log(`[aether:bounty] New submission for bounty ${bountyId}: ${submission.id}`);
    return submission;
  }

  /**
   * 接受提交
   * @param bountyId - 赏金ID
   * @param submissionId - 提交ID
   * @returns 更新后的提交对象
   */
  acceptSubmission(bountyId: string, submissionId: string): BountySubmission {
    const bounty = this.bounties.get(bountyId);
    if (!bounty) {
      throw new BountyError(`Bounty not found: ${bountyId}`, 'NOT_FOUND');
    }

    const submission = this.submissions.get(submissionId);
    if (!submission || submission.bountyId !== bountyId) {
      throw new BountyError(`Submission not found: ${submissionId}`, 'NOT_FOUND');
    }

    submission.status = 'accepted';
    submission.reviewNotes = 'Submission accepted. Reward will be disbursed.';

    bounty.status = 'awarded';
    bounty.winnerId = submissionId;

    this._rewriteSubmissions();
    this._rewriteBounties();

    console.log(`[aether:bounty] Accepted submission ${submissionId} for bounty ${bountyId}`);
    return submission;
  }

  /**
   * 拒绝提交
   * @param bountyId - 赏金ID
   * @param submissionId - 提交ID
   * @param reason - 拒绝原因
   * @returns 更新后的提交对象
   */
  rejectSubmission(
    bountyId: string,
    submissionId: string,
    reason: string,
  ): BountySubmission {
    const bounty = this.bounties.get(bountyId);
    if (!bounty) {
      throw new BountyError(`Bounty not found: ${bountyId}`, 'NOT_FOUND');
    }

    const submission = this.submissions.get(submissionId);
    if (!submission || submission.bountyId !== bountyId) {
      throw new BountyError(`Submission not found: ${submissionId}`, 'NOT_FOUND');
    }

    submission.status = 'rejected';
    submission.reviewNotes = reason;

    this._rewriteSubmissions();

    console.log(`[aether:bounty] Rejected submission ${submissionId}: ${reason}`);
    return submission;
  }

  /**
   * 关闭赏金（无winner）
   * @param id - 赏金ID
   * @returns 更新后的赏金对象
   */
  closeBounty(id: string): Bounty {
    const bounty = this.bounties.get(id);
    if (!bounty) {
      throw new BountyError(`Bounty not found: ${id}`, 'NOT_FOUND');
    }
    if (bounty.status !== 'open') {
      throw new BountyError(`Bounty is not open: ${bounty.status}`, 'INVALID_STATE');
    }

    bounty.status = 'closed';
    this._rewriteBounties();

    console.log(`[aether:bounty] Closed bounty: ${id}`);
    return bounty;
  }

  /**
   * 获取赏金统计信息
   * @returns 聚合统计数据
   */
  getBountyStats(): BountyStats {
    const bounties = Array.from(this.bounties.values());

    const stats: BountyStats = {
      totalBounties: bounties.length,
      openBounties: 0,
      closedBounties: 0,
      awardedBounties: 0,
      totalSubmissions: this.submissions.size,
      totalRewardValue: 0,
      byCategory: {
        feature: 0,
        bugfix: 0,
        integration: 0,
        documentation: 0,
        security: 0,
        other: 0,
      },
      byDifficulty: {
        beginner: 0,
        intermediate: 0,
        advanced: 0,
        expert: 0,
      },
    };

    for (const bounty of bounties) {
      // Count by status
      if (bounty.status === 'open') stats.openBounties++;
      else if (bounty.status === 'closed') stats.closedBounties++;
      else if (bounty.status === 'awarded') stats.awardedBounties++;

      // Sum reward value (converted to numeric for simplicity)
      stats.totalRewardValue += bounty.reward;

      // Count by category
      stats.byCategory[bounty.category]++;

      // Count by difficulty
      stats.byDifficulty[bounty.difficulty]++;
    }

    return stats;
  }
}
