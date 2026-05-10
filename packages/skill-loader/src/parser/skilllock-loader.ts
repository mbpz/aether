import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
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