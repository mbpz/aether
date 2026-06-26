// SkillpackLockLoader contract tests — B8.3 retro-fit.
// parseDepRef + resolveDep + validateIntegrity + loadLockFile.
import { createHash } from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SkillpackLockLoader } from './skilllock-loader.js';

describe('SkillpackLockLoader', () => {
  let workdir: string;
  let loader: SkillpackLockLoader;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'aether-skillpack-'));
    loader = new SkillpackLockLoader();
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  describe('parseDepRef', () => {
    it('parses skillpack/name@version', () => {
      const result = loader.parseDepRef('skillpack/code-generator@1.0.0');
      expect(result).toEqual({ name: 'code-generator', version: '1.0.0' });
    });

    it('returns null for invalid format', () => {
      expect(loader.parseDepRef('invalid')).toBeNull();
      expect(loader.parseDepRef('code-generator@1.0.0')).toBeNull();
      expect(loader.parseDepRef('skillpack/code-generator')).toBeNull();
    });
  });

  describe('resolveDep', () => {
    it('resolves a dependency from lock.resolved', () => {
      const lock = {
        version: '1',
        resolved: {
          'skillpack/utils@1.0.0': { name: 'utils', version: '1.0.0', trustScore: 90, integrity: '' },
        },
      } as unknown as Parameters<typeof loader.resolveDep>[1];
      const entry = loader.resolveDep('skillpack/utils@1.0.0', lock);
      expect(entry?.name).toBe('utils');
    });

    it('returns null for unresolved deps', () => {
      const lock = { version: '1', resolved: {} } as unknown as Parameters<typeof loader.resolveDep>[1];
      expect(loader.resolveDep('skillpack/missing@1.0.0', lock)).toBeNull();
    });

    it('accepts a dep ref without skillpack/ prefix (auto-prefixes)', () => {
      const lock = {
        version: '1',
        resolved: {
          'skillpack/utils@1.0.0': { name: 'utils', version: '1.0.0', trustScore: 90, integrity: '' },
        },
      } as unknown as Parameters<typeof loader.resolveDep>[1];
      const entry = loader.resolveDep('utils@1.0.0', lock);
      expect(entry?.name).toBe('utils');
    });
  });

  describe('validateIntegrity', () => {
    it('returns true when entry has no integrity field', () => {
      const entry = { name: 'x', version: '1', trustScore: 90, integrity: '' };
      expect(loader.validateIntegrity(entry, 'any content')).toBe(true);
    });

    it('matches sha256 hash of content', () => {
      const content = 'hello world';
      const hash = `sha256:${createHash('sha256').update(content).digest('hex')}`;
      const entry = { name: 'x', version: '1', trustScore: 90, integrity: hash };
      expect(loader.validateIntegrity(entry, content)).toBe(true);
    });

    it('returns false when hash mismatches', () => {
      const entry = { name: 'x', version: '1', trustScore: 90, integrity: 'sha256:wrong' };
      expect(loader.validateIntegrity(entry, 'actual content')).toBe(false);
    });
  });

  describe('loadLockFile', () => {
    it('returns null for missing lock file', () => {
      expect(loader.loadLockFile(workdir)).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      writeFileSync(join(workdir, '.skillpack-lock.json'), '{ not valid json');
      expect(loader.loadLockFile(workdir)).toBeNull();
    });

    it('returns null for missing version/resolved', () => {
      writeFileSync(join(workdir, '.skillpack-lock.json'), '{"foo": 1}');
      expect(loader.loadLockFile(workdir)).toBeNull();
    });

    it('returns the parsed lock for valid input', () => {
      const valid = {
        version: '1',
        resolved: {
          'skillpack/utils@1.0.0': { name: 'utils', version: '1.0.0', trustScore: 90, integrity: '' },
        },
      };
      writeFileSync(join(workdir, '.skillpack-lock.json'), JSON.stringify(valid));
      const r = loader.loadLockFile(workdir);
      expect(r?.version).toBe('1');
    });
  });
});