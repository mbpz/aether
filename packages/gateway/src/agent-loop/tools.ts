// EP-05: Agent Loop - 工具注册表
// 定义 Tool 接口与内置工具，提供 ToolRegistry 管理工具注册与查找

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  description?: string;
  items?: JSONSchema;
  enum?: unknown[];
  [key: string]: unknown;
}

export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute(params: Record<string, unknown>): Promise<unknown>;
}

// ── 工具注册中心 ──────────────────────────────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[aether:tools] Tool "${tool.name}" already registered; overwriting.`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }
}

// ── 内置工具工厂（依赖注入形式，避免循环引用）────────────────────────────────

export interface BuiltinToolDeps {
  /** 调用沙箱执行代码，接受 { code: string }，返回执行结果 */
  execCode?: (code: string) => Promise<unknown>;
  /** 写记忆 */
  rememberFn?: (content: string, meta?: Record<string, unknown>) => unknown;
  /** 检索记忆 */
  recallFn?: (query: string, limit?: number) => unknown;
  /** 查 Gateway 状态 */
  getStatusFn?: () => unknown;
}

export function createBuiltinTools(deps: BuiltinToolDeps = {}): Tool[] {
  const execCode: Tool = {
    name: 'exec_code',
    description: '在沙箱中执行一段 JavaScript 代码，返回执行结果',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要执行的 JavaScript 代码' },
      },
      required: ['code'],
    },
    async execute(params) {
      const code = String(params.code ?? '');
      if (!code.trim()) return { ok: false, error: 'No code provided' };
      if (deps.execCode) {
        return deps.execCode(code);
      }
      // 无沙箱后端：拒绝执行任意 JS，避免使用 `new Function` 之类的主机级
      // 求值路径绕过 zero-trust 契约。`execCode` 应当指向真正的沙箱实现
      // (isolated-vm / WASM runtime)。
      return {
        ok: false,
        error:
          'No sandbox backend is wired into the agent-loop. The exec_code ' +
          'tool requires a real sandbox (isolated-vm or WASM runtime) and ' +
          'cannot fall back to unsafe JS evaluation.',
      };
    },
  };

  const remember: Tool = {
    name: 'remember',
    description: '将内容写入记忆系统（L1 工作记忆）',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '要记忆的内容' },
        importance: { type: 'number', description: '重要度 0~1，默认 0.5' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
      },
      required: ['content'],
    },
    async execute(params) {
      const content = String(params.content ?? '');
      const meta: Record<string, unknown> = {};
      if (params.importance !== undefined) meta.importance = Number(params.importance);
      if (Array.isArray(params.tags)) meta.tags = params.tags;

      if (deps.rememberFn) {
        const entry = deps.rememberFn(content, meta);
        return { ok: true, entry };
      }
      return { ok: true, stored: content.slice(0, 50) + '...' };
    },
  };

  const recall: Tool = {
    name: 'recall',
    description: '从记忆系统中检索相关内容',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词或问题' },
        limit: { type: 'number', description: '最多返回条数，默认 5' },
      },
      required: ['query'],
    },
    async execute(params) {
      const query = String(params.query ?? '');
      const limit = typeof params.limit === 'number' ? params.limit : 5;
      if (deps.recallFn) {
        return deps.recallFn(query, limit);
      }
      return { entries: [], total: 0, queryMs: 0 };
    },
  };

  const getStatus: Tool = {
    name: 'get_status',
    description: '获取 Gateway 系统状态信息',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute(_params) {
      if (deps.getStatusFn) {
        return deps.getStatusFn();
      }
      return {
        status: 'ok',
        system: 'aether-gateway',
        timestamp: new Date().toISOString(),
      };
    },
  };

  return [execCode, remember, recall, getStatus];
}
