// LLMManager contract tests — B8.3 retro-fit. Pure logic, no HTTP.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LLMManager } from './manager.js';

describe('LLMManager', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Wipe env so initFromEnv doesn't pick up ambient state.
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_TYPE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('initial state', () => {
    it('starts unconfigured', () => {
      const m = new LLMManager();
      expect(m.isConfigured).toBe(false);
      expect(m.provider).toBeNull();
      expect(m.safeConfig()).toBeNull();
    });
  });

  describe('configure', () => {
    it('makes provider available after configure', () => {
      const m = new LLMManager();
      m.configure({ type: 'custom', baseUrl: 'http://x', apiKey: 'k', model: 'm' });
      expect(m.isConfigured).toBe(true);
      expect(m.provider).not.toBeNull();
    });

    it('safeConfig exposes hasApiKey but not the key itself', () => {
      const m = new LLMManager();
      m.configure({ type: 'custom', baseUrl: 'http://x', apiKey: 'sk-secret', model: 'm' });
      const safe = m.safeConfig();
      expect(safe).not.toBeNull();
      expect(safe!.hasApiKey).toBe(true);
      expect((safe as unknown as { apiKey?: string }).apiKey).toBeUndefined();
    });
  });

  describe('initFromEnv', () => {
    it('returns false when env vars are absent', () => {
      const m = new LLMManager();
      expect(m.initFromEnv()).toBe(false);
      expect(m.isConfigured).toBe(false);
    });

    it('configures when LLM_BASE_URL + LLM_MODEL are set', () => {
      process.env.LLM_BASE_URL = 'http://env-host';
      process.env.LLM_MODEL = 'env-model';
      process.env.LLM_API_KEY = 'env-key';
      process.env.LLM_TYPE = 'custom';
      const m = new LLMManager();
      expect(m.initFromEnv()).toBe(true);
      expect(m.provider?.model).toBe('env-model');
    });

    it('returns false when only LLM_BASE_URL is set', () => {
      process.env.LLM_BASE_URL = 'http://x';
      const m = new LLMManager();
      expect(m.initFromEnv()).toBe(false);
    });
  });

  describe('presets', () => {
    it('returns non-empty list of preset configs', () => {
      const m = new LLMManager();
      const list = m.presets();
      expect(list.length).toBeGreaterThanOrEqual(1);
      for (const p of list) {
        expect(typeof p.id).toBe('string');
        expect(typeof p.config).toBe('object');
      }
    });
  });

  describe('ping (no provider configured)', () => {
    it('returns ok:false with descriptive error', async () => {
      const m = new LLMManager();
      const r = await m.ping();
      expect(r.ok).toBe(false);
      expect(r.error).toBe('No provider configured');
    });
  });
});