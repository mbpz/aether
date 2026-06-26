// ManifestEngine contract tests — B8.1 retro-fit.
// validate + register + getManifest + listManifests. Loads from MANIFEST_DIR
// env which is not set in tests, so loadManifestsFromDir is a no-op.
import { describe, it, expect } from 'vitest';
import { ManifestEngine } from './engine.js';

describe('ManifestEngine', () => {
  describe('default manifest (no MANIFEST_DIR env)', () => {
    it('rejects exec operation by default', () => {
      const m = new ManifestEngine();
      const r = m.validate({ operation: 'exec' });
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/exec.*not permitted/);
    });

    it('rejects network operation by default', () => {
      const m = new ManifestEngine();
      const r = m.validate({ operation: 'network', target: 'example.com' });
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/network/);
    });

    it('rejects filesystem operation by default', () => {
      const m = new ManifestEngine();
      const r = m.validate({ operation: 'filesystem' });
      expect(r.allowed).toBe(false);
    });

    it('allows unknown operations by default (passes through)', () => {
      const m = new ManifestEngine();
      // operation='other' is not exec/network/filesystem → no rule rejects.
      const r = m.validate({ operation: 'other' });
      expect(r.allowed).toBe(true);
    });
  });

  describe('register + lookup', () => {
    it('register stores a manifest reachable via getManifest', () => {
      const m = new ManifestEngine();
      m.register({
        name: 'permissive',
        version: '1.0',
        operations: { exec: true, network: true, filesystem: true },
        network: { blockExternal: false, allowedHosts: [] },
        filesystem: { readPaths: ['/'], writePaths: ['/'] },
      });
      const got = m.getManifest('permissive');
      expect(got?.name).toBe('permissive');
    });

    it('listManifests includes registered names', () => {
      const m = new ManifestEngine();
      m.register({
        name: 'perm-a',
        version: '1.0',
        operations: { exec: true, network: true, filesystem: true },
      });
      m.register({
        name: 'perm-b',
        version: '1.0',
        operations: { exec: true, network: true, filesystem: true },
      });
      const list = m.listManifests();
      expect(list).toContain('perm-a');
      expect(list).toContain('perm-b');
    });

    it('getManifest returns undefined for unknown name', () => {
      const m = new ManifestEngine();
      expect(m.getManifest('does-not-exist')).toBeUndefined();
    });
  });

  describe('validate with custom manifest', () => {
    it('permissive manifest allows exec', () => {
      const m = new ManifestEngine();
      m.register({
        name: 'permissive',
        version: '1.0',
        operations: { exec: true, network: true, filesystem: true },
      });
      const r = m.validate({ operation: 'exec', manifestName: 'permissive' });
      expect(r.allowed).toBe(true);
    });

    it('network manifest enforces allowedHosts when blockExternal=true', () => {
      const m = new ManifestEngine();
      m.register({
        name: 'restricted-net',
        version: '1.0',
        operations: { network: true, exec: false, filesystem: false },
        network: { blockExternal: true, allowedHosts: ['api.example.com'] },
      });
      const allowed = m.validate({
        operation: 'network',
        target: 'api.example.com',
        manifestName: 'restricted-net',
      });
      expect(allowed.allowed).toBe(true);

      const denied = m.validate({
        operation: 'network',
        target: 'evil.com',
        manifestName: 'restricted-net',
      });
      expect(denied.allowed).toBe(false);
      expect(denied.reason).toMatch(/not in allowedHosts/);
    });

    it('falls back to defaultManifest when manifestName not found', () => {
      const m = new ManifestEngine();
      const r = m.validate({ operation: 'exec', manifestName: 'nonexistent' });
      // Default manifest rejects exec.
      expect(r.allowed).toBe(false);
    });
  });
});
