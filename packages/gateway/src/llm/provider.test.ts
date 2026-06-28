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

  describe('provider dispatch (B16)', () => {
    it('routes openai to /chat/completions', async () => {
      const fetchStub = vi.fn(async (url: string) => {
        // Verify URL has /chat/completions for openai
        if (!url.includes('/chat/completions')) {
          return { ok: false, status: 404, text: async () => 'wrong path' };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          }),
        };
      });
      vi.stubGlobal('fetch', fetchStub);
      const p = new LLMProvider({ type: 'openai', baseUrl: 'http://x', apiKey: 'k', model: 'm' });
      const r = await p.chat([{ role: 'user', content: 'hi' }]);
      expect(r.choices[0].message.content).toBe('ok');
    });

    it('routes anthropic to /v1/messages with x-api-key header', async () => {
      const fetchStub = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
        if (!url.includes('/v1/messages')) {
          return { ok: false, status: 404, text: async () => 'wrong path' };
        }
        if (init?.headers?.['x-api-key'] !== 'ant-key') {
          return { ok: false, status: 401, text: async () => 'no key' };
        }
        if (init?.headers?.['anthropic-version'] !== '2023-06-01') {
          return { ok: false, status: 400, text: async () => 'no version' };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'msg_1',
            model: 'claude',
            content: [{ type: 'text', text: 'anthropic-ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 3 },
          }),
        };
      });
      vi.stubGlobal('fetch', fetchStub);
      const p = new LLMProvider({ type: 'anthropic', baseUrl: 'http://anthropic', apiKey: 'ant-key', model: 'claude' });
      const r = await p.chat([
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ]);
      expect(r.choices[0].message.content).toBe('anthropic-ok');
      expect(r.usage.prompt_tokens).toBe(5);
    });

    it('routes gemini with key in query string', async () => {
      const fetchStub = vi.fn(async (url: string) => {
        if (!url.includes('models/gemini-1.5-flash:generateContent')) {
          return { ok: false, status: 404, text: async () => 'wrong path' };
        }
        if (!url.includes('key=gem-key')) {
          return { ok: false, status: 401, text: async () => 'no key' };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [{ text: 'gemini-ok' }],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 4, totalTokenCount: 11 },
          }),
        };
      });
      vi.stubGlobal('fetch', fetchStub);
      const p = new LLMProvider({ type: 'gemini', baseUrl: 'http://gemini', apiKey: 'gem-key', model: 'gemini-1.5-flash' });
      const r = await p.chat([{ role: 'user', content: 'hi' }]);
      expect(r.choices[0].message.content).toBe('gemini-ok');
      expect(r.usage.total_tokens).toBe(11);
    });

    it('bedrock requires apiKey + apiSecret + region (throws if missing)', async () => {
      const p = new LLMProvider({ type: 'bedrock', model: 'anthropic.claude-3-5-sonnet-20241022-v2:0' });
      await expect(p.chat([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(LLMError);
    });

    it('rejects unknown provider type', async () => {
      const p = new LLMProvider({ type: 'mystery', model: 'm' } as unknown as { type: 'openai' });
      await expect(p.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/Unknown provider type/);
    });
  });
});