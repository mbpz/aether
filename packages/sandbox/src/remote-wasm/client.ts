export interface WasmExecutionRequest {
  moduleId: string;
  function: string;
  args: unknown[];
  timeoutMs: number;
}

export interface WasmExecutionResponse {
  result: unknown;
  logs: string[];
  executionTimeMs: number;
  error?: string;
}

export class RemoteWasmClient {
  private endpoint: string;
  private timeoutMs: number;

  constructor(endpoint: string, timeoutMs = 30000) {
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
  }

  async execute(req: WasmExecutionRequest): Promise<WasmExecutionResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const resp = await fetch(`${this.endpoint}/v1/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: controller.signal as any,
      });

      clearTimeout(timer);

      if (!resp.ok) {
        const error = await resp.text();
        return { result: null, logs: [], executionTimeMs: 0, error: `HTTP ${resp.status}: ${error}` };
      }

      return await resp.json() as WasmExecutionResponse;
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      return { result: null, logs: [], executionTimeMs: 0, error: msg };
    }
  }

  async health(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.endpoint}/health`, { method: 'GET' });
      return resp.ok;
    } catch {
      return false;
    }
  }
}