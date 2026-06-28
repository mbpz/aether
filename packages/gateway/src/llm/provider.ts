// EP-07: LLM Provider - OpenAI-Compatible HTTP Client
// 零外部依赖，使用 Node 18+ 内置 fetch

import { createHash, createHmac } from 'crypto';
import type {
  LLMProviderConfig,
  LLMRequest,
  LLMResponse,
  ChatMessage,
  ToolDef,
} from './types.js';

// ── Provider-specific response shapes (only used by the normalizers) ─────────

interface AnthropicResponse {
  id: string;
  model: string;
  content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>;
  stop_reason: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{ text: string } | { functionCall?: { name: string; args?: Record<string, unknown> } }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

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
  get baseUrl(): string | undefined { return this.config.baseUrl; }
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
    // Dispatch to the right request shape / response parser per provider.
    // The OpenAI-compatible family (openai / ollama / openrouter / custom
    // / deepseek) shares /chat/completions. Anthropic, Gemini, and
    // Bedrock have their own protocols. Adding a new provider = adding
    // one branch here + one preset in types.ts.
    switch (this.config.type) {
      case 'openai':
      case 'ollama':
      case 'openrouter':
      case 'custom':
        return this._chatOpenAICompat(messages, opts);
      case 'anthropic':
        return this._chatAnthropic(messages, opts);
      case 'gemini':
        return this._chatGemini(messages, opts);
      case 'bedrock':
        return this._chatBedrock(messages, opts);
      default:
        throw new LLMError(`Unknown provider type: ${(this.config as { type: string }).type}`, 'INVALID_CONFIG');
    }
  }

  // ── OpenAI-compatible (openai / ollama / openrouter / custom / deepseek) ──

  private async _chatOpenAICompat(
    messages: ChatMessage[],
    opts: { tools?: ToolDef[]; temperature?: number; maxTokens?: number },
  ): Promise<LLMResponse> {
    const url = `${this.config.baseUrl!.replace(/\/$/, '')}/chat/completions`;

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

    const res = await this._fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(bodyWithModel) });

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

  // ── Anthropic native (POST /v1/messages) ─────────────────────────────────

  private async _chatAnthropic(
    messages: ChatMessage[],
    opts: { tools?: ToolDef[]; temperature?: number; maxTokens?: number },
  ): Promise<LLMResponse> {
    const url = `${this.config.baseUrl!.replace(/\/$/, '')}/v1/messages`;

    // Anthropic: system is a top-level field, not a message. Strip
    // any system messages and forward them as a top-level `system`.
    let systemText = '';
    const userMessages = messages.filter((m) => {
      if (m.role === 'system') {
        systemText += (systemText ? '\n\n' : '') + m.content;
        return false;
      }
      return true;
    });

    // Anthropic tool_choice: 'auto' | 'any' | { type: 'tool', name }.
    // Map OpenAI 'auto' → Anthropic 'auto'.
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: opts.maxTokens ?? this.config.maxTokens,
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (systemText) body.system = systemText;
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    else if (this.config.temperature !== undefined) body.temperature = this.config.temperature;
    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
      body.tool_choice = { type: 'auto' };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (this.config.apiKey) headers['x-api-key'] = this.config.apiKey;

    const res = await this._fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new LLMError(`Anthropic API error ${res.status}: ${errBody.slice(0, 300)}`, 'API_ERROR', res.status);
    }
    const data = await res.json() as AnthropicResponse;
    return this._normalizeAnthropic(data);
  }

  // ── Google Gemini (POST /v1beta/models/{model}:generateContent) ────────────

  private async _chatGemini(
    messages: ChatMessage[],
    opts: { tools?: ToolDef[]; temperature?: number; maxTokens?: number },
  ): Promise<LLMResponse> {
    const url = `${this.config.baseUrl!.replace(/\/$/, '')}/models/${this.config.model}:generateContent`;

    // Gemini uses a `contents` array with role 'user' | 'model'. System
    // instructions go in `systemInstruction.parts`. Tool calling is
    // a separate `tools` block with `functionDeclarations`.
    let systemText = '';
    const userMessages = messages.filter((m) => {
      if (m.role === 'system') { systemText += (systemText ? '\n\n' : '') + m.content; return false; }
      return true;
    });

    const body: Record<string, unknown> = {
      contents: userMessages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
    if (opts.tools && opts.tools.length > 0) {
      body.tools = [{
        functionDeclarations: opts.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }];
    }
    const genConfig: Record<string, unknown> = {};
    if (opts.maxTokens ?? this.config.maxTokens) genConfig.maxOutputTokens = opts.maxTokens ?? this.config.maxTokens;
    if (opts.temperature ?? this.config.temperature !== undefined) {
      genConfig.temperature = opts.temperature ?? this.config.temperature;
    }
    if (Object.keys(genConfig).length) body.generationConfig = genConfig;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      // Gemini API key is a query param, NOT a header.
      const u = new URL(url);
      u.searchParams.set('key', this.config.apiKey);
      // Re-construct url with the key embedded; safer than mutating url.
      const res = await this._fetchWithTimeout(u.toString(), { method: 'POST', headers, body: JSON.stringify(body) });
      return this._normalizeGemini(await res.json() as GeminiResponse, res.ok, res.status);
    }
    const res = await this._fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(body) });
    return this._normalizeGemini(await res.json() as GeminiResponse, res.ok, res.status);
  }

  // ── AWS Bedrock (InvokeModel with SigV4 signing) ───────────────────────────

  private async _chatBedrock(
    messages: ChatMessage[],
    opts: { tools?: ToolDef[]; temperature?: number; maxTokens?: number },
  ): Promise<LLMResponse> {
    // Bedrock expects AWS SigV4-signed requests. The "model" field
    // is the bedrock model id (e.g. 'anthropic.claude-3-5-sonnet-...').
    // We invoke via the `InvokeModel` action; for Anthropic models
    // the body is the same shape as the Anthropic Messages API.
    if (!this.config.apiKey || !this.config.apiSecret || !this.config.region) {
      throw new LLMError('Bedrock requires apiKey, apiSecret, and region', 'INVALID_CONFIG');
    }
    let systemText = '';
    const userMessages = messages.filter((m) => {
      if (m.role === 'system') { systemText += (systemText ? '\n\n' : '') + m.content; return false; }
      return true;
    });
    const anthropicBody: Record<string, unknown> = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: opts.maxTokens ?? this.config.maxTokens,
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (systemText) anthropicBody.system = systemText;
    if (opts.tools && opts.tools.length > 0) {
      anthropicBody.tools = opts.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }
    const url = `https://bedrock-runtime.${this.config.region}.amazonaws.com/model/${encodeURIComponent(this.config.model)}/invoke`;
    const bodyStr = JSON.stringify(anthropicBody);
    const headers = this._signAwsSigV4('POST', url, bodyStr, this.config.apiKey, this.config.apiSecret, this.config.region);
    const res = await this._fetchWithTimeout(url, { method: 'POST', headers, body: bodyStr });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new LLMError(`Bedrock API error ${res.status}: ${errBody.slice(0, 300)}`, 'API_ERROR', res.status);
    }
    const data = await res.json() as AnthropicResponse;
    return this._normalizeAnthropic(data);
  }

  // ── Shared helpers ──────────────────────────────────────────────────────────

  private async _fetchWithTimeout(
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs!);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
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
  }

  /**
   * AWS SigV4 signing for the Bedrock InvokeModel endpoint.
   * Implements only the headers Aether needs (no x-amz-content-sha256
   * pre-computation, no query string signing). Sufficient for
   * InvokeModel on Anthropic models in the us-east-1 region.
   */
  private _signAwsSigV4(
    method: string,
    url: string,
    body: string,
    accessKey: string,
    secretKey: string,
    region: string,
    service: string = 'bedrock',
  ): Record<string, string> {
    const u = new URL(url);
    const host = u.host;
    const path = u.pathname;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash('sha256').update(body).digest('hex');
    const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const kDate = createHmac('sha256', `AWS4${secretKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(region).digest();
    const kService = createHmac('sha256', kRegion).update(service).digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    return {
      'Content-Type': 'application/json',
      Host: host,
      'X-Amz-Date': amzDate,
      'X-Amz-Content-Sha256': payloadHash,
      'Authorization': `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  // ── Normalizers (provider-specific response → LLMResponse) ────────────────

  private _normalizeAnthropic(data: AnthropicResponse): LLMResponse {
    // Anthropic Messages response:
    // { content: [{ type: 'text' | 'tool_use', text?, ... }], stop_reason, usage }
    const textPart = data.content?.find((p) => p.type === 'text');
    const toolUsePart = data.content?.find((p) => p.type === 'tool_use');
    return {
      id: data.id,
      model: data.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: textPart?.text ?? '',
            tool_calls: toolUsePart ? [
              {
                id: toolUsePart.id,
                type: 'function',
                function: { name: toolUsePart.name!, arguments: JSON.stringify(toolUsePart.input) },
              },
            ] : undefined,
          },
          finish_reason: data.stop_reason ?? 'stop',
        },
      ],
      usage: {
        prompt_tokens: data.usage?.input_tokens ?? 0,
        completion_tokens: data.usage?.output_tokens ?? 0,
        total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
    };
  }

  private async _normalizeGemini(data: GeminiResponse, ok: boolean, status: number): Promise<LLMResponse> {
    if (!ok) {
      throw new LLMError(`Gemini API error ${status}: ${JSON.stringify(data).slice(0, 300)}`, 'API_ERROR', status);
    }
    const cand = data.candidates?.[0];
    const textPart = cand?.content?.parts?.find((p) => 'text' in p);
    const fnCall = cand?.content?.parts?.find((p) => 'functionCall' in p) as { functionCall?: { name: string; args: Record<string, unknown> } } | undefined;
    return {
      id: `gemini-${Date.now()}`,
      model: this.config.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content: textPart?.text ?? '',
            tool_calls: fnCall?.functionCall ? [
              {
                id: `gemini-${Date.now()}`,
                type: 'function',
                function: { name: fnCall.functionCall.name, arguments: JSON.stringify(fnCall.functionCall.args ?? {}) },
              },
            ] : undefined,
          },
          finish_reason: cand?.finishReason ?? 'stop',
        },
      ],
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
      },
    };
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
