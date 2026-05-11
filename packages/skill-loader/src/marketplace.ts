// Skill Marketplace - 技能市场
// 提供技能发现、评分、分类和安全管理

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SkillParser, Skill } from './parser/skill-parser.js';
import { SkillSecurityAuditor } from './audit/skill-auditor.js';

/**
 * SkillManifest - 技能在市场上的元数据清单
 */
export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: 'productivity' | 'developer' | 'enterprise' | 'ai' | 'other';
  tags: string[];
  rating?: number;
  downloads?: number;
  certified: boolean; // passed security audit
  price: 'free' | 'paid';
  skillPath: string; // path to SKILL.md
  createdAt: string;
  updatedAt: string;
}

/**
 * MarketplaceStats - 市场聚合统计
 */
export interface MarketplaceStats {
  totalSkills: number;
  byCategory: Record<string, number>;
  topRated: SkillManifest[];
  recentlyAdded: SkillManifest[];
}

/**
 * SearchFilters - 搜索过滤选项
 */
export interface SearchFilters {
  category?: SkillManifest['category'];
  certified?: boolean;
  price?: 'free' | 'paid';
  tags?: string[];
  minRating?: number;
}

/**
 * Category auto-detection keywords
 */
const CATEGORY_KEYWORDS: Record<SkillManifest['category'], string[]> = {
  productivity: ['productivity', '效率', 'workflow', 'automation', 'automation', 'tool'],
  developer: ['developer', 'development', 'devops', 'code', 'git', 'testing', 'deploy', '编程', '开发'],
  enterprise: ['enterprise', 'business', 'crm', 'erp', 'workflow', 'collaboration', '企业', '商业'],
  ai: ['ai', 'artificial', 'intelligence', 'llm', 'gpt', 'nlp', 'model', '人工智能', '机器学习'],
  other: [],
};

/**
 * MarketplaceError - 市场操作错误
 */
export class MarketplaceError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'ALREADY_EXISTS' | 'AUDIT_FAILED' | 'PERSISTENCE_ERROR',
  ) {
    super(message);
    this.name = 'MarketplaceError';
  }
}

/**
 * SkillMarketplace - 技能市场核心类
 * 提供技能的发现、注册、搜索、评分和统计功能
 */
export class SkillMarketplace {
  private skills: Map<string, SkillManifest> = new Map();
  private ratings: Map<string, number[]> = new Map(); // skillId -> ratings[]
  private dataDir: string;
  private parser: SkillParser;
  private auditor: SkillSecurityAuditor;

  /**
   * 创建技能市场实例
   * @param dataDir - 市场数据存储目录 (default: runtime/marketplace/)
   */
  constructor(dataDir = 'runtime/marketplace/') {
    this.dataDir = dataDir;
    this.parser = new SkillParser();
    this.auditor = new SkillSecurityAuditor();
    this._ensureDataDir();
    this._loadPersistedData();
  }

  private _ensureDataDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private _loadPersistedData(): void {
    const manifestsPath = join(this.dataDir, 'manifests.jsonl');
    const ratingsPath = join(this.dataDir, 'ratings.json');

    // Load manifests
    if (existsSync(manifestsPath)) {
      try {
        const content = readFileSync(manifestsPath, 'utf-8');
        const lines = content.trim().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const manifest = JSON.parse(line) as SkillManifest;
              this.skills.set(manifest.id, manifest);
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      } catch (err) {
        console.warn('[aether:marketplace] Failed to load manifests:', err);
      }
    }

    // Load ratings
    if (existsSync(ratingsPath)) {
      try {
        const data = JSON.parse(readFileSync(ratingsPath, 'utf-8')) as Record<string, number[]>;
        this.ratings = new Map(Object.entries(data));
      } catch (err) {
        console.warn('[aether:marketplace] Failed to load ratings:', err);
      }
    }
  }

  private _persistManifest(manifest: SkillManifest): void {
    const manifestsPath = join(this.dataDir, 'manifests.jsonl');
    try {
      writeFileSync(manifestsPath, JSON.stringify(manifest) + '\n', { flag: 'a' });
    } catch (err) {
      throw new MarketplaceError(
        `Failed to persist manifest: ${err instanceof Error ? err.message : String(err)}`,
        'PERSISTENCE_ERROR',
      );
    }
  }

  private _rewriteManifests(): void {
    const manifestsPath = join(this.dataDir, 'manifests.jsonl');
    try {
      const lines = Array.from(this.skills.values())
        .map((m) => JSON.stringify(m))
        .join('\n') + '\n';
      writeFileSync(manifestsPath, lines);
    } catch (err) {
      throw new MarketplaceError(
        `Failed to rewrite manifests: ${err instanceof Error ? err.message : String(err)}`,
        'PERSISTENCE_ERROR',
      );
    }
  }

  private _persistRatings(): void {
    const ratingsPath = join(this.dataDir, 'ratings.json');
    try {
      const obj = Object.fromEntries(this.ratings.entries());
      writeFileSync(ratingsPath, JSON.stringify(obj, null, 2));
    } catch (err) {
      throw new MarketplaceError(
        `Failed to persist ratings: ${err instanceof Error ? err.message : String(err)}`,
        'PERSISTENCE_ERROR',
      );
    }
  }

  /**
   * Auto-detect category based on skill content
   */
  private _detectCategory(skill: Skill): SkillManifest['category'] {
    const text = [
      skill.level1.name,
      skill.level1.description,
      ...(skill.level1.tags ?? []),
    ]
      .join(' ')
      .toLowerCase();

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (category === 'other') continue;
      for (const keyword of keywords) {
        if (text.includes(keyword.toLowerCase())) {
          return category as SkillManifest['category'];
        }
      }
    }
    return 'other';
  }

  /**
   * List all available skills in the marketplace
   * @returns Array of all registered skill manifests
   */
  list(): SkillManifest[] {
    return Array.from(this.skills.values());
  }

  /**
   * Search skills by query and optional filters
   * @param query - Search query (matches name, description, tags)
   * @param filters - Optional filters for category, certified, price, tags, minRating
   * @returns Matching skill manifests
   */
  search(query: string, filters?: SearchFilters): SkillManifest[] {
    let results = Array.from(this.skills.values());

    // Text search
    if (query && query.trim()) {
      const q = query.toLowerCase().trim();
      results = results.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    // Apply filters
    if (filters) {
      if (filters.category) {
        results = results.filter((m) => m.category === filters.category);
      }
      if (filters.certified !== undefined) {
        results = results.filter((m) => m.certified === filters.certified);
      }
      if (filters.price) {
        results = results.filter((m) => m.price === filters.price);
      }
      if (filters.tags && filters.tags.length > 0) {
        results = results.filter((m) =>
          filters.tags!.some((t) => m.tags.includes(t)),
        );
      }
      if (filters.minRating !== undefined) {
        results = results.filter((m) => (m.rating ?? 0) >= filters.minRating!);
      }
    }

    return results;
  }

  /**
   * Get a single skill manifest by ID
   * @param id - Skill manifest ID
   * @returns Skill manifest or null if not found
   */
  getById(id: string): SkillManifest | null {
    return this.skills.get(id) ?? null;
  }

  /**
   * Register a new skill to the marketplace
   * Performs security scan before listing
   * @param skillPath - Path to the SKILL.md file
   * @returns The registered skill manifest
   * @throws MarketplaceError if security audit fails or skill already exists
   */
  async register(skillPath: string): Promise<SkillManifest> {
    // Check if already registered
    const existing = Array.from(this.skills.values()).find((m) => m.skillPath === skillPath);
    if (existing) {
      throw new MarketplaceError(
        `Skill already registered: ${skillPath}`,
        'ALREADY_EXISTS',
      );
    }

    // Parse the skill
    let skill: Skill;
    try {
      skill = this.parser.parseFromFile(skillPath);
    } catch (err) {
      throw new MarketplaceError(
        `Failed to parse skill: ${err instanceof Error ? err.message : String(err)}`,
        'PERSISTENCE_ERROR',
      );
    }

    // Security audit
    const report = this.auditor.scan({
      content: skill.rawContent,
      frontmatter: skill.level1 as unknown as Record<string, unknown>,
      skillId: skill.id,
      skillName: skill.level1.name,
      source: skill.source,
    });

    if (!report.allowed) {
      throw new MarketplaceError(
        `Security audit failed for ${skill.level1.name}: trust score ${report.trustScore} (threshold 80)`,
        'AUDIT_FAILED',
      );
    }

    // Create manifest
    const now = new Date().toISOString();
    const manifest: SkillManifest = {
      id: uuidv4(),
      name: skill.level1.name,
      version: skill.level1.version,
      author: skill.level1.author ?? 'unknown',
      description: skill.level1.description,
      category: this._detectCategory(skill),
      tags: skill.level1.tags ?? [],
      certified: report.allowed,
      price: 'free', // Default for now, can be extended with paid tier
      skillPath,
      createdAt: now,
      updatedAt: now,
    };

    // Persist and store
    this._persistManifest(manifest);
    this.skills.set(manifest.id, manifest);
    this.ratings.set(manifest.id, []);

    console.log(`[aether:marketplace] Registered skill: ${manifest.name} (id=${manifest.id})`);
    return manifest;
  }

  /**
   * Rate a skill (1-5 stars)
   * @param id - Skill manifest ID
   * @param rating - Rating value (1-5)
   * @returns Updated average rating for the skill
   */
  rate(id: string, rating: number): number {
    const manifest = this.skills.get(id);
    if (!manifest) {
      throw new MarketplaceError(`Skill not found: ${id}`, 'NOT_FOUND');
    }

    // Clamp rating to 1-5
    const clampedRating = Math.max(1, Math.min(5, Math.round(rating)));

    const ratings = this.ratings.get(id) ?? [];
    ratings.push(clampedRating);
    this.ratings.set(id, ratings);

    // Update manifest with new average
    const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    manifest.rating = Math.round(avgRating * 10) / 10; // Keep one decimal
    manifest.updatedAt = new Date().toISOString();

    this._persistRatings();
    this._rewriteManifests();

    return manifest.rating;
  }

  /**
   * Remove a skill from the marketplace
   * @param id - Skill manifest ID
   */
  remove(id: string): void {
    const manifest = this.skills.get(id);
    if (!manifest) {
      throw new MarketplaceError(`Skill not found: ${id}`, 'NOT_FOUND');
    }

    this.skills.delete(id);
    this.ratings.delete(id);
    this._rewriteManifests();
    this._persistRatings();

    console.log(`[aether:marketplace] Removed skill: ${manifest.name} (id=${id})`);
  }
}

/**
 * Get aggregated marketplace statistics
 * @param marketplace - SkillMarketplace instance
 * @returns MarketplaceStats with total skills, category breakdown, top rated, and recently added
 */
export function getMarketplaceStats(marketplace: SkillMarketplace): MarketplaceStats {
  const skills = marketplace.list();

  // Category breakdown
  const byCategory: Record<string, number> = {};
  for (const skill of skills) {
    byCategory[skill.category] = (byCategory[skill.category] ?? 0) + 1;
  }

  // Sort by rating (descending) for top rated
  const topRated = [...skills]
    .filter((s) => s.rating !== undefined)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, 10);

  // Sort by creation date (descending) for recently added
  const recentlyAdded = [...skills]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  return {
    totalSkills: skills.length,
    byCategory,
    topRated,
    recentlyAdded,
  };
}