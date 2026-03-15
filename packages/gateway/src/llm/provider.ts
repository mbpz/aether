// EP-07: LLM Provider - OpenAI-Compatible HTTP Client
// 零外部依赖，使用 Node 18+ 内置 fetch

import type {
  LLMProviderConfig,
  LLMRequest,
  LLMResponse,
  ChatMessage,
  ToolDef,
} from './types.js';

// ── 错误类型 ──────────────────────────────────────────────────────────────────

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

// ── LLM Provider ──────────────────────────────────────────────────────────────

export class LLMProvider {
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = {
      timeoutMs: 60_000,
      temperature: 0.7,
      maxTokens: 4096,
      ...config,
    };
  }

  get model(): string { return this.config.model; }
  get baseUrl(): string { return this.config.baseUrl; }
  get type(): string { return this.config.type; }

  /**
   * 发送 chat completion 请求
   */
  async chat(
    messages: ChatMessage[],
    opts: {
      tools?: ToolDef[];
      temperature?: number;
      maxTokens?: number;
    } = {},
  ): Promise<LLMResponse> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;

    const body: LLMRequest = {
      messages,
      temperature: opts.temperature ?? this.config.temperature,
      max_tokens: opts.maxTokens ?? this.config.maxTokens,
      stream: false,
    };

    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
      body.tool_choice = 'auto';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    // OpenRouter 需要额外 header
    if (this.config.type === 'openrouter') {
      headers['HTTP-Referer'] = 'https://aether.local';
      headers['X-Title'] = 'Aether Agent';
    }

    const bodyWithModel = { ...body, model: this.config.model };

    console.log(
      `[aether:llm] → ${this.config.type} ${this.config.model} | msgs=${messages.length} tools=${opts.tools?.length ?? 0}`,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs!);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyWithModel),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new LLMError('Request timed out', 'TIMEOUT');
      }
      throw new LLMError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK_ERROR',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let errBody = '';
      try { errBody = await res.text(); } catch (_) { /* ignore */ }
      throw new LLMError(
        `LLM API error ${res.status}: ${errBody.slice(0, 300)}`,
        'API_ERROR',
        res.status,
      );
    }

    let data: LLMResponse;
    try {
      data = await res.json() as LLMResponse;
    } catch (err) {
      throw new LLMError('Failed to parse LLM response JSON', 'PARSE_ERROR');
    }

    console.log(
      `[aether:llm] ← ${data.model ?? this.config.model} | finish=${data.choices?.[0]?.finish_reason} tokens=${data.usage?.total_tokens ?? '?'}`,
    );

    return data;
  }

  /**
   * 测试连通性（发送最小请求）
   */
  async ping(): Promise<{ ok: boolean; model: string; latencyMs: number; error?: string }> {
    const t0 = Date.now();
    try {
      const resp = await this.chat([
        { role: 'user', content: 'Reply with just "ok".' },
      ], { maxTokens: 10, temperature: 0 });
      return {
        ok: true,
        model: resp.model ?? this.config.model,
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        ok: false,
        model: this.config.model,
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** 导出可序列化配置（隐去 apiKey） */
  toSafeConfig(): Omit<LLMProviderConfig, 'apiKey'> & { hasApiKey: boolean } {
    const { apiKey, ...rest } = this.config;
    return { ...rest, hasApiKey: !!apiKey };
  }

  /** 用新配置创建副本 */
  withConfig(patch: Partial<LLMProviderConfig>): LLMProvider {
    return new LLMProvider({ ...this.config, ...patch });
  }
}
