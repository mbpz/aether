// Aether Skill Loader - 技能加载器
// Phase 3: 技能市场上线

// Marketplace (技能市场)
export {
  SkillMarketplace,
  SkillManifest,
  MarketplaceStats,
  SearchFilters,
  MarketplaceError,
  getMarketplaceStats,
} from './marketplace.js';

// Parser (SKILL.md 解析器)
export { SkillParser, Skill, SkillMetadata, SkillInstructions, SkillResources } from './parser/skill-parser.js';

// Registry (技能注册表)
export { SkillRegistry } from './registry/registry.js';

// Security Audit (安全审计)
export { SkillSecurityAuditor } from './audit/skill-auditor.js';
export type { AuditReport, AuditIssue, AuditConfig, IssueType, IssueSeverity } from './audit/auditor-types.js';

// Zero-Trust Audit (ZTA) Security Scoring
export { SecurityScorer, scoreSecurity } from './audit/security-scorer.js';
export type { SecurityScore, SecurityFlag, ScorerConfig } from './audit/security-scorer.js';

// Format utilities
export { detectFormat } from './format-detector.js';
export type { SkillFormat, FormatDetectionResult } from './format-detector.js';