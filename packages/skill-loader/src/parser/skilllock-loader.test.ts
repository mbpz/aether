import { createHash } from 'crypto';
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
    it('returns null for non-existent directory', () => {
      const result = loader.loadLockFile('/nonexistent/path');
      expect(result).toBeNull();
    });
  });

  describe('validateIntegrity', () => {
    it('returns true when entry has no integrity field', () => {
      const entry = { name: 'test', version: '1.0.0' };
      const result = loader.validateIntegrity(entry, 'any content');
      expect(result).toBe(true);
    });

    it('validates correct sha256 hash', () => {
      const content = 'test content';
      const hash = createHash('sha256').update(content).digest('hex');
      const entry = {
        name: 'test',
        version: '1.0.0',
        integrity: `sha256:${hash}`,
      };
      const result = loader.validateIntegrity(entry, content);
      expect(result).toBe(true);
    });

    it('rejects incorrect hash', () => {
      const entry = {
        name: 'test',
        version: '1.0.0',
        integrity: 'sha256:wronghash',
      };
      const result = loader.validateIntegrity(entry, 'any content');
      expect(result).toBe(false);
    });
  });
});