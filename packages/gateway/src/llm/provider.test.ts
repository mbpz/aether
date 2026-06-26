// LLMProvider contract tests — B8.3. Pure paths: toSafeConfig, withConfig,
// and the chat() error / response shape via stubbed fetch.
// Does NOT actually hit a remote LLM (CI-friendly).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LLMProvider, LLMError } from './provider.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeProvider() {
  return new LLMProvider({ type: 'custom', baseUrl: 'http://example.com', apiKey: 'sk-test', model: 'test-model' });
}

describe('LLMProvider', () => {
  describe('construction', () => {
    it('exposes the configured model + baseUrl', () => {
      const p = makeProvider();
      expect(p.model).toBe('test-model');
      expect(p.baseUrl).toBe('http://example.com');
    });

    it('applies defaults for missing fields', () => {
      const p = new LLMProvider({ type: 'custom', baseUrl: 'http://x', apiKey: 'k', model: 'm' });
      expect(p.type).toBe('custom');
    });
  });

  describe('toSafeConfig', () => {
    it('exposes hasApiKey=true but does not include apiKey', () => {
      const p = makeProvider();
      const safe = p.toSafeConfig();
      expect(safe.hasApiKey).toBe(true);
      expect((safe as unknown as { apiKey?: string }).apiKey).toBeUndefined();
      expect(safe.model).toBe('test-model');
    });
  });

  describe('withConfig', () => {
    it('returns a new provider with patched config, leaving the original untouched', () => {
      const p1 = makeProvider();
      const p2 = p1.withConfig({ model: 'patched-model' });
      expect(p2.model).toBe('patched-model');
      // Original is unchanged.
      expect(p1.model).toBe('test-model');
    });
  });

  describe('chat error handling', () => {
    it('throws LLMError when fetch rejects', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
      const p = makeProvider();
      await expect(p.chat([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(LLMError);
    });

    it('throws LLMError on non-2xx response', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'oops',
      })));
      const p = makeProvider();
      await expect(p.chat([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(LLMError);
    });
  });

  describe('chat happy path', () => {
    it('returns the assistant content on 2xx', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            { message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' },
          ],
        }),
      })));
      const p = makeProvider();
      const r = await p.chat([{ role: 'user', content: 'hi' }]);
      expect(r.choices[0].message.content).toBe('hello');
    });
  });

  describe('ping', () => {
    it('returns ok=false when fetch rejects', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net'); }));
      const p = makeProvider();
      const r = await p.ping();
      expect(r.ok).toBe(false);
      expect(r.error).toBeDefined();
    });
  });
});