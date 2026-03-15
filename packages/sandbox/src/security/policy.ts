// Security Policy - 沙箱安全策略定义
// 定义执行环境的访问控制边界

export interface PolicyConfig {
  blockNetwork: boolean;        // 阻断所有网络访问
  blockFilesystem: boolean;     // 阻断文件系统访问
  blockProcessSpawn: boolean;   // 阻断子进程生成
  maxExecTimeMs: number;        // 最大执行时间（ms）
  maxMemoryMb: number;          // 最大内存使用（MB）
  allowedModules?: string[];    // 允许 import 的模块白名单
  allowedGlobals?: string[];    // 允许访问的全局变量
}

export interface PolicyViolation {
  type: 'network' | 'filesystem' | 'process' | 'timeout' | 'memory' | 'module';
  detail: string;
  blocked: true;
}

export class SecurityPolicy {
  readonly config: PolicyConfig;

  // 默认允许的安全模块
  private static readonly SAFE_MODULES = [
    'crypto',      // 仅哈希/随机数
    'util',        // 工具函数
    'path',        // 路径处理（不访问 FS）
    'url',         // URL 解析
    'querystring', // 查询字符串
    'stream',      // 流（内存）
    'buffer',      // Buffer 操作
    'events',      // 事件发射器
    'assert',      // 断言
    'zlib',        // 压缩
  ];

  // 默认允许的全局变量
  private static readonly SAFE_GLOBALS = [
    'console', 'Math', 'Date', 'JSON', 'parseInt', 'parseFloat',
    'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'clearTimeout',
    'Promise', 'Symbol', 'Map', 'Set', 'WeakMap', 'WeakSet',
    'Array', 'Object', 'String', 'Number', 'Boolean', 'RegExp',
    'Error', 'TypeError', 'RangeError', 'Uint8Array', 'ArrayBuffer',
  ];

  constructor(config: PolicyConfig) {
    this.config = {
      ...config,
      allowedModules: config.allowedModules ?? SecurityPolicy.SAFE_MODULES,
      allowedGlobals: config.allowedGlobals ?? SecurityPolicy.SAFE_GLOBALS,
    };
  }

  /**
   * 检查模块是否允许 import
   */
  checkModule(moduleName: string): PolicyViolation | null {
    const allowed = this.config.allowedModules ?? [];
    // 阻断所有网络相关模块
    const networkModules = ['http', 'https', 'net', 'tls', 'dgram', 'dns', 'http2'];
    // 阻断所有文件系统模块
    const fsModules = ['fs', 'fs/promises', 'child_process', 'cluster', 'worker_threads'];

    if (this.config.blockNetwork && networkModules.includes(moduleName)) {
      return {
        type: 'network',
        detail: `Module '${moduleName}' is blocked: network access is not permitted`,
        blocked: true,
      };
    }

    if (this.config.blockFilesystem && fsModules.includes(moduleName)) {
      return {
        type: 'filesystem',
        detail: `Module '${moduleName}' is blocked: filesystem access is not permitted`,
        blocked: true,
      };
    }

    if (this.config.blockProcessSpawn && moduleName === 'child_process') {
      return {
        type: 'process',
        detail: `Module '${moduleName}' is blocked: process spawning is not permitted`,
        blocked: true,
      };
    }

    if (!allowed.includes(moduleName)) {
      return {
        type: 'module',
        detail: `Module '${moduleName}' is not in the allowed modules whitelist`,
        blocked: true,
      };
    }

    return null;
  }

  /**
   * 静态代码扫描：检测潜在的安全风险
   */
  scanCode(code: string): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    // 检测网络访问模式
    if (this.config.blockNetwork) {
      const networkPatterns = [
        /require\s*\(\s*['"]https?['"]\s*\)/,
        /require\s*\(\s*['"]net['"]\s*\)/,
        /fetch\s*\(/,
        /XMLHttpRequest/,
        /WebSocket\s*\(/,
        /import\s+.*\s+from\s+['"]https?:\/\//,
      ];
      for (const pattern of networkPatterns) {
        if (pattern.test(code)) {
          violations.push({
            type: 'network',
            detail: `Detected potential network access pattern: ${pattern.toString()}`,
            blocked: true,
          });
          break;
        }
      }
    }

    // 检测文件系统访问
    if (this.config.blockFilesystem) {
      const fsPatterns = [
        /require\s*\(\s*['"]fs['"]\s*\)/,
        /readFileSync|writeFileSync|readFile|writeFile/,
        /createReadStream|createWriteStream/,
      ];
      for (const pattern of fsPatterns) {
        if (pattern.test(code)) {
          violations.push({
            type: 'filesystem',
            detail: `Detected potential filesystem access: ${pattern.toString()}`,
            blocked: true,
          });
          break;
        }
      }
    }

    // 检测进程操作
    if (this.config.blockProcessSpawn) {
      const processPatterns = [
        /child_process/,
        /exec\s*\(/,
        /spawn\s*\(/,
        /execSync\s*\(/,
        /process\.exit/,
        /process\.env/,
      ];
      for (const pattern of processPatterns) {
        if (pattern.test(code)) {
          violations.push({
            type: 'process',
            detail: `Detected potential process operation: ${pattern.toString()}`,
            blocked: true,
          });
          break;
        }
      }
    }

    return violations;
  }

  summary() {
    return {
      blockNetwork: this.config.blockNetwork,
      blockFilesystem: this.config.blockFilesystem,
      blockProcessSpawn: this.config.blockProcessSpawn,
      maxExecTimeMs: this.config.maxExecTimeMs,
      maxMemoryMb: this.config.maxMemoryMb,
      allowedModules: this.config.allowedModules,
    };
  }
}
