# Skillpack Frontmatter Dependency Design

**Date:** 2026-05-10
**Status:** Approved

## 1. Overview

Add Skillpack dependency resolution to Aether's skill system. Skills declare dependencies via `skillpack/xxx@version` references in their frontmatter. The system resolves and verifies dependencies before loading, treating each `skillpack://` reference as a distinct skill source with its own metadata.

## 2. Key Design Decision

**Dependency reference in frontmatter.** Skills use `dependencies: ['skillpack/name@version']` in frontmatter. The loader resolves each reference at load time, fetching and validating the dependency before the parent skill loads.

## 3. Architecture

### 3.1 Types

```typescript
// packages/skill-loader/src/parser/skilllock-types.ts

export interface SkillpackLock {
  version: string;           // lockfile format version
  resolved: Record<string, SkillpackEntry>;  // name@version → entry
  metadata?: Record<string, unknown>;
}

export interface SkillpackEntry {
  name: string;
  version: string;
  integrity?: string;         // SHA-256 hash for integrity
  path?: string;             // local path (for dev deps)
  remote?: string;           // remote URL
  dependencies?: string[];   // transitive dependencies
  trustScore?: number;
}

// SkillMetadata.source values expand to include 'skillpack'
type SkillSource = 'manus' | 'openclaw' | 'aether' | 'skillpack' | 'unknown';
```

### 3.2 Integration Points

**`SkillParser.parseFromContent()`** expands to:
1. Extract `dependencies: ['skillpack/xxx@1.2.3', ...]` from frontmatter
2. Validate each entry against local lock file (`.skillpack-lock.json`)
3. If lock file has entry, inject resolved metadata into skill level1
4. If no lock file entry, flag warning (unresolved dep)

**Lock file location:** `<skill-dir>/.skillpack-lock.json` (next to SKILL.md)

**Lock file format:**
```json
{
  "version": "1.0",
  "resolved": {
    "skillpack/code-generator@1.0.0": {
      "name": "code-generator",
      "version": "1.0.0",
      "path": "./deps/code-generator-1.0.0/SKILL.md",
      "integrity": "sha256:abc123..."
    }
  }
}
```

### 3.3 Loader Behavior

| Scenario | Behavior |
|----------|----------|
| Lock file exists, dep resolved | Load skill, inherit dep trust score, mark source='skillpack' |
| Lock file exists, dep unresolved | Warning log, skip dep inheritance |
| Lock file missing | Warn that lock file should be committed |
| Dep version conflict | Error: "skillpack/xxx@version not satisfied" |

## 4. Implementation Plan

1. Create `packages/skill-loader/src/parser/skilllock-types.ts` with `SkillpackLock`, `SkillpackEntry` interfaces
2. Create `packages/skill-loader/src/parser/skilllock-loader.ts` with `SkillpackLockLoader` class:
   - `loadLockFile(dir: string): SkillpackLock | null`
   - `resolveDep(dep: string, lock: SkillpackLock): SkillpackEntry | null`
   - `validateIntegrity(entry: SkillpackEntry): boolean`
3. Modify `SkillParser.parseFromContent()` to:
   - Accept optional lock file path
   - Parse `dependencies` from frontmatter
   - Call lock loader for resolution
   - Add resolved deps to skill metadata
4. Add unit tests for lock loading and dep resolution

## 5. Out of Scope

- Remote registry fetching (local lock files only for MVP)
- Lock file generation/gating (can be added later)
- Semantic version ranges (exact `name@version` only for MVP)
- Trust score propagation beyond local lock file validation