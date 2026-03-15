// EP-07: LLM Manager - Provider 生命周期管理
// 持久化配置到 .env / 内存，提供当前 provider 单例

import { LLMProvider, LLMError } from './provider.js';
import type { LLMProviderConfig } from './types.js';
import { PROVIDER_PRESETS } from './types.js';

export { LLMError };

export class LLMManager {
  private _provider: LLMProvider | null = null;
  private _config: LLMProviderConfig | null = null;

  /** 是否已配置 */
  get isConfigured(): boolean {
    return this._provider !== null;
  }

  /** 当前 provider（未配置时返回 null） */
  get provider(): LLMProvider | null {
    return this._provider;
  }

  /**
   * 应用配置，创建 provider（不立即连接）
   */
  configure(config: LLMProviderConfig): void {
    // 如果是预设名，合并预设
    const preset = PROVIDER_PRESETS[config.type] ?? {};
    const merged: LLMProviderConfig = { ...preset, ...config };
    this._config = merged;
    this._provider = new LLMProvider(merged);
    console.log(
      `[aether:llm-manager] ✅ Configured: ${merged.type} ${merged.model} @ ${merged.baseUrl}`,
    );
  }

  /**
   * 从环境变量初始化（启动时调用）
   * 支持：
   *   LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_TYPE
   */
  initFromEnv(): boolean {
    const baseUrl = process.env.LLM_BASE_URL;
    const model = process.env.LLM_MODEL;
    if (!baseUrl || !model) return false;

    this.configure({
      type: (process.env.LLM_TYPE ?? 'custom') as LLMProviderConfig['type'],
      baseUrl,
      apiKey: process.env.LLM_API_KEY,
      model,
      timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS ?? '60000', 10),
      temperature: parseFloat(process.env.LLM_TEMPERATURE ?? '0.7'),
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS ?? '4096', 10),
    });
    return true;
  }

  /** 测试当前 provider 连通性 */
  async ping(): Promise<{ ok: boolean; model: string; latencyMs: number; error?: string }> {
    if (!this._provider) {
      return { ok: false, model: '', latencyMs: 0, error: 'No provider configured' };
    }
    return this._provider.ping();
  }

  /** 安全配置（不含 apiKey） */
  safeConfig(): (Omit<LLMProviderConfig, 'apiKey'> & { hasApiKey: boolean }) | null {
    return this._provider?.toSafeConfig() ?? null;
  }

  /** 获取可用预设列表 */
  presets(): Array<{ id: string; config: Partial<LLMProviderConfig> }> {
    return Object.entries(PROVIDER_PRESETS).map(([id, config]) => ({ id, config }));
  }
}
