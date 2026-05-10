// Skillpack lock file type definitions
// Supports skillpack/name@version dependency references in SKILL.md frontmatter

export interface SkillpackEntry {
  name: string;
  version: string;
  /** SHA-256 integrity hash */
  integrity?: string;
  /** Local path relative to lock file (for dev/resolved deps) */
  path?: string;
  /** Remote URL (if not local) */
  remote?: string;
  /** Transitive dependencies */
  dependencies?: string[];
  /** Trust score inherited from lock file */
  trustScore?: number;
}

export interface SkillpackLock {
  /** Lockfile format version */
  version: string;
  /** name@version → entry mapping */
  resolved: Record<string, SkillpackEntry>;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}