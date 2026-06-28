// EP-07: LLM Provider - 类型定义
// 支持 OpenAI-compatible API（OpenAI / Ollama / OpenRouter / DeepSeek 等）

// ── 消息格式 ──────────────────────────────────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: MessageRole;
  content: string;
  /** function call 结果时用到 */
  tool_call_id?: string;
  /** assistant 调用工具时 */
  tool_calls?: ToolCall[];
}

// ── Tool / Function Calling ───────────────────────────────────────────────────

export interface FunctionDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; [key: string]: unknown }>;
    required?: string[];
  };
}

export interface ToolDef {
  type: 'function';
  function: FunctionDef;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON 字符串 */
    arguments: string;
  };
}

// ── LLM 请求 / 响应 ───────────────────────────────────────────────────────────

export interface LLMRequest {
  messages: ChatMessage[];
  tools?: ToolDef[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  stream?: false;
}

export interface LLMResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: 'stop' | 'tool_calls' | 'length' | string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ── Provider 配置 ─────────────────────────────────────────────────────────────

export interface LLMProviderConfig {
  /** Provider 类型标识 */
  type: 'openai' | 'ollama' | 'openrouter' | 'anthropic' | 'gemini' | 'bedrock' | 'custom';
  /**
   * OpenAI-compatible: `https://api.openai.com/v1` (default if omitted)
   * Anthropic:           `https://api.anthropic.com`
   * Gemini:              `https://generativelanguage.googleapis.com/v1beta`
   * Bedrock:             `https://bedrock-runtime.<region>.amazonaws.com`
   */
  baseUrl?: string;
  /**
   * OpenAI / Gemini: sent as `Authorization: Bearer <key>`.
   * Anthropic:        sent as `x-api-key: <key>` + `anthropic-version`.
   * Bedrock:          used as the AWS access key id (apiSecret is the
   *                   secret access key for SigV4 signing).
   * Ollama:           may be any non-empty string (not validated).
   */
  apiKey?: string;
  /** Bedrock SigV4: AWS secret access key. Required when type='bedrock'. */
  apiSecret?: string;
  /** Bedrock: AWS region (e.g. 'us-east-1'). Required when type='bedrock'. */
  region?: string;
  /** 使用的模型名称 */
  model: string;
  /** 请求超时 ms，默认 60000 */
  timeoutMs?: number;
  /** 温度，默认 0.7 */
  temperature?: number;
  /** 最大 token，默认 4096 */
  maxTokens?: number;
}

/** 已知预设 */
export const PROVIDER_PRESETS: Record<string, Partial<LLMProviderConfig>> = {
  openai: {
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  ollama: {
    type: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'ollama',
    model: 'llama3.2',
  },
  openrouter: {
    type: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
  },
  deepseek: {
    type: 'custom',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  anthropic: {
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-3-5-haiku-20241022',
  },
  gemini: {
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-1.5-flash',
  },
  bedrock: {
    type: 'bedrock',
    model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    region: 'us-east-1',
  },
};
