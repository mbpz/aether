# Skillpack Dependency Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Skillpack lock file compatibility via frontmatter dependency references (`skillpack/name@version`) with local lock file validation.

**Architecture:** Add `SkillpackLock` / `SkillpackEntry` types, create `SkillpackLockLoader` class that loads and validates against `.skillpack-lock.json` files, integrate into `SkillParser` to resolve dependencies at parse time.

**Tech Stack:** TypeScript, Node.js `fs` / `crypto`, existing `js-yaml` dependency.

---

## File Structure

| File | Purpose |
|------|---------|
| Create: `packages/skill-loader/src/parser/skilllock-types.ts` | `SkillpackLock`, `SkillpackEntry` interfaces |
| Create: `packages/skill-loader/src/parser/skilllock-loader.ts` | `SkillpackLockLoader` class — load, resolve, validate |
| Modify: `packages/skill-loader/src/parser/skill-parser.ts` | Inject lock-loader integration into `parseFromContent()` |
| Create: `packages/skill-loader/src/parser/skilllock-loader.test.ts` | Unit tests for lock loading and dep resolution |

---

## Task 1: Create `skilllock-types.ts`

**Files:**
- Create: `packages/skill-loader/src/parser/skilllock-types.ts`

- [ ] **Step 1: Write the types file**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/skill-loader/src/parser/skilllock-types.ts
git commit -m "types: add SkillpackLock and SkillpackEntry interfaces"
```

---

## Task 2: Create `SkillpackLockLoader` class

**Files:**
- Create: `packages/skill-loader/src/parser/skilllock-loader.ts`
- Test: `packages/skill-loader/src/parser/skilllock-loader.test.ts`

- [ ] **Step 1: Write the SkillpackLockLoader class**

```typescript
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { SkillpackLock, SkillpackEntry } from './skilllock-types.js';

export class SkillpackLockLoader {
  /**
   * Load and parse .skillpack-lock.json from a directory.
   * Returns null if lock file doesn't exist.
   */
  loadLockFile(dir: string): SkillpackLock | null {
    const lockPath = join(dir, '.skillpack-lock.json');
    if (!existsSync(lockPath)) {
      return null;
    }
    try {
      const raw = readFileSync(lockPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed.version || !parsed.resolved) {
        throw new Error('Invalid lock file: missing version or resolved');
      }
      return parsed as SkillpackLock;
    } catch (err) {
      console.warn(`[aether:skillpack] Failed to load lock file ${lockPath}:`, err);
      return null;
    }
  }

  /**
   * Resolve a 'skillpack/name@version' dependency from a lock.
   * Returns the entry if found, null if unresolved.
   */
  resolveDep(dep: string, lock: SkillpackLock): SkillpackEntry | null {
    const key = dep.startsWith('skillpack/') ? dep : `skillpack/${dep}`;
    return lock.resolved[key] ?? null;
  }

  /**
   * Validate integrity hash of a skillpack entry.
   * If entry has no integrity field, returns true (trust score used instead).
   */
  validateIntegrity(entry: SkillpackEntry, content: string): boolean {
    if (!entry.integrity) return true;
    const hash = `sha256:${createHash('sha256').update(content).digest('hex')}`;
    return hash === entry.integrity;
  }

  /**
   * Parse a 'skillpack/name@version' string into { name, version }.
   */
  parseDepRef(ref: string): { name: string; version: string } | null {
    const match = ref.match(/^skillpack\/([^@]+)@(.+)$/);
    if (!match) return null;
    return { name: match[1], version: match[2] };
  }
}
```

- [ ] **Step 2: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { SkillpackLockLoader } from './skilllock-loader.js';

describe('SkillpackLockLoader', () => {
  const loader = new SkillpackLockLoader();

  describe('parseDepRef', () => {
    it('parses skillpack/name@version format', () => {
      const result = loader.parseDepRef('skillpack/code-generator@1.0.0');
      expect(result).toEqual({ name: 'code-generator', version: '1.0.0' });
    });

    it('returns null for invalid format', () => {
      expect(loader.parseDepRef('invalid')).toBeNull();
      expect(loader.parseDepRef('skillpack/no-version')).toBeNull();
      expect(loader.parseDepRef('npm/pkg@1.0.0')).toBeNull();
    });
  });

  describe('resolveDep', () => {
    const lock = {
      version: '1.0',
      resolved: {
        'skillpack/code-generator@1.0.0': {
          name: 'code-generator',
          version: '1.0.0',
          path: './deps/code-generator/SKILL.md',
          integrity: 'sha256:abc123',
        },
      },
    };

    it('resolves existing dep', () => {
      const entry = loader.resolveDep('skillpack/code-generator@1.0.0', lock);
      expect(entry).not.toBeNull();
      expect(entry!.name).toBe('code-generator');
    });

    it('returns null for missing dep', () => {
      expect(loader.resolveDep('skillpack/missing@1.0.0', lock)).toBeNull();
    });
  });

  describe('loadLockFile', () => {
    it('returns null for non-existent directory', async () => {
      const result = loader.loadLockFile('/nonexistent/path');
      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd packages/skill-loader && npm test -- --run src/parser/skilllock-loader.test.ts 2>&1
```

Expected: FAIL — file not found (will show different error after file creation)

- [ ] **Step 4: Commit loader and tests**

```bash
git add packages/skill-loader/src/parser/skilllock-loader.ts packages/skill-loader/src/parser/skilllock-loader.test.ts
git commit -m "feat(skill-loader): add SkillpackLockLoader for lock file resolution"
```

---

## Task 3: Integrate into `SkillParser`

**Files:**
- Modify: `packages/skill-loader/src/parser/skill-parser.ts`

- [ ] **Step 1: Add skillpack source type**

In the `Skill` interface, update `source` type to include `'skillpack'`:

```typescript
// Before
source: 'manus' | 'openclaw' | 'aether' | 'unknown';

// After
source: 'manus' | 'openclaw' | 'aether' | 'skillpack' | 'unknown';
```

- [ ] **Step 2: Add lock loader integration**

Add to `SkillParser` constructor:

```typescript
import { SkillpackLockLoader, SkillpackEntry } from './skilllock-loader.js';

export class SkillParser {
  private parser = new SkillParser();
  private lockLoader = new SkillpackLockLoader();
```

Update `parseFromContent()` to accept optional `lockDir` parameter and resolve dependencies:

```typescript
parseFromContent(content: string, source = 'unknown', lockDir?: string): Skill {
  const frontmatter = this.extractFrontmatter(content);
  const sections = this.extractSections(content);

  // Detect source
  let skillSource = this.detectSource(content, frontmatter);

  // Load skillpack lock file if directory provided
  let lockEntries: SkillpackEntry[] = [];
  if (lockDir) {
    const lock = this.lockLoader.loadLockFile(lockDir);
    if (lock) {
      const deps = frontmatter.dependencies as string[] | undefined;
      if (Array.isArray(deps)) {
        for (const dep of deps) {
          if (dep.startsWith('skillpack/')) {
            const entry = this.lockLoader.resolveDep(dep, lock);
            if (entry) lockEntries.push(entry);
            else console.warn(`[aether:skillpack] Unresolved dep: ${dep} in ${lockDir}`);
          }
        }
        if (lockEntries.length > 0) skillSource = 'skillpack';
      }
    } else {
      console.warn(`[aether:skillpack] Lock file not found in ${lockDir}`);
    }
  }

  // Level 1 metadata
  const level1: SkillMetadata = {
    name: frontmatter.name ?? this.extractTitle(content) ?? 'Unknown Skill',
    // ... existing fields ...
    trustScore: frontmatter.trust_score ??
      (lockEntries.length > 0 ? lockEntries[0].trustScore : 0),
    // ... existing fields ...
  };
```

- [ ] **Step 3: Run TypeScript build to verify**

```bash
cd packages/skill-loader && npm run build 2>&1
```

Expected: PASS (or show type errors if frontmatter.dependencies needs casting)

- [ ] **Step 4: Commit**

```bash
git add packages/skill-loader/src/parser/skill-parser.ts
git commit -m "feat(skill-loader): integrate SkillpackLockLoader for skillpack dependencies"
```

---

## Task 4: Add SkillRegistry lock directory support

**Files:**
- Modify: `packages/skill-loader/src/registry/registry.ts`

- [ ] **Step 1: Update `scanDirectory` to pass lock dir**

In `scanDirectory`, when a skill is found at `filePath`, derive lock dir as `dirname(filePath)`:

```typescript
private async tryLoadSkill(filePath: string): Promise<number> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lockDir = dirname(filePath);
    const skill = this.parser.parseFromContent(content, 'unknown', lockDir);
    this.register(skill);
    return 1;
  } catch {
    return 0;
  }
}
```

Add missing `readFileSync` import at top of registry.ts.

- [ ] **Step 2: Build and verify**

```bash
cd packages/skill-loader && npm run build 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add packages/skill-loader/src/registry/registry.ts
git commit -m "feat(skill-loader): pass lock dir to parser during scan"
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|-----------------|------|
| `SkillpackLock` / `SkillpackEntry` interfaces | Task 1 |
| `SkillpackLockLoader` class (load/resolve/validate) | Task 2 |
| Lock file location `.skillpack-lock.json` | Task 2 (`loadLockFile`) |
| `dependencies: ['skillpack/xxx@version']` frontmatter parsing | Task 3 |
| Source type `'skillpack'` | Task 3 |
| Trust score inheritance from lock entry | Task 3 |
| Integration into `SkillRegistry.scanDirectory` | Task 4 |
| Unit tests | Task 2 |

No gaps found.

---

## Type Consistency Check

- `SkillpackLock.version` (string) — Task 1
- `SkillpackLock.resolved` (Record<string, SkillpackEntry>) — Task 1
- `SkillpackEntry.name`, `.version`, `.integrity`, `.path` — Task 1
- `SkillpackLockLoader.loadLockFile(dir: string)` — Task 2
- `SkillpackLockLoader.resolveDep(dep: string, lock: SkillpackLock)` — Task 2
- `SkillParser.parseFromContent(content, source, lockDir?)` — Task 3

All consistent across tasks.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-10-skillpack-dependency-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?