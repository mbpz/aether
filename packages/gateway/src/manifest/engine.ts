// Manifest Engine - 权限清单审计引擎
// 所有外部输入必须通过 Manifest 验证才能执行

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

export interface PermissionManifest {
  name: string;
  version: string;
  // 允许访问的网络白名单
  network?: {
    allowedHosts?: string[];
    allowedPorts?: number[];
    blockExternal?: boolean; // 默认 true，禁止一切外网
  };
  // 允许的文件系统路径
  filesystem?: {
    readPaths?: string[];
    writePaths?: string[];
  };
  // 允许的系统操作
  operations?: {
    exec?: boolean;        // 是否允许执行外部命令
    network?: boolean;     // 是否允许网络访问
    filesystem?: boolean;  // 是否允许文件系统操作
  };
  // 允许的 API 调用
  allowedApis?: string[];
}

export interface ManifestValidationResult {
  allowed: boolean;
  reason?: string;
  manifest?: PermissionManifest;
}

export class ManifestEngine {
  private manifests: Map<string, PermissionManifest> = new Map();
  private defaultManifest: PermissionManifest = {
    name: 'default-restrictive',
    version: '1.0',
    network: {
      blockExternal: true,
      allowedHosts: ['127.0.0.1', 'localhost'],
    },
    filesystem: {
      readPaths: [],
      writePaths: [],
    },
    operations: {
      exec: false,
      network: false,
      filesystem: false,
    },
  };

  constructor() {
    this.loadManifestsFromDir();
  }

  private loadManifestsFromDir() {
    const manifestDir = process.env.MANIFEST_DIR ?? './manifests';
    if (!existsSync(manifestDir)) return;

    try {
      const files = readdirSync(manifestDir)
        .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
        .map((f) => join(manifestDir, f));

      for (const file of files) {
        const content = readFileSync(file, 'utf-8');
        const manifest = yaml.load(content) as PermissionManifest;
        if (manifest?.name) {
          this.manifests.set(manifest.name, manifest);
          console.log(`[aether:manifest] Loaded manifest: ${manifest.name}`);
        }
      }
    } catch (err) {
      console.warn('[aether:manifest] Failed to load manifests:', err);
    }
  }

  /**
   * 验证一个操作请求是否符合权限清单
   */
  validate(
    request: {
      operation: string;
      target?: string;
      manifestName?: string;
    }
  ): ManifestValidationResult {
    const manifest = request.manifestName
      ? (this.manifests.get(request.manifestName) ?? this.defaultManifest)
      : this.defaultManifest;

    // 检查操作类型
    if (request.operation === 'exec' && !manifest.operations?.exec) {
      return { allowed: false, reason: 'exec operations are not permitted by manifest', manifest };
    }

    if (request.operation === 'network') {
      if (!manifest.operations?.network) {
        return { allowed: false, reason: 'network operations are not permitted by manifest', manifest };
      }
      // 检查目标主机
      if (request.target && manifest.network?.blockExternal) {
        const allowedHosts = manifest.network.allowedHosts ?? [];
        const isAllowed = allowedHosts.some((h) => request.target!.includes(h));
        if (!isAllowed) {
          return {
            allowed: false,
            reason: `network target ${request.target} is not in allowedHosts`,
            manifest,
          };
        }
      }
    }

    if (request.operation === 'filesystem' && !manifest.operations?.filesystem) {
      return { allowed: false, reason: 'filesystem operations are not permitted by manifest', manifest };
    }

    return { allowed: true, manifest };
  }

  /**
   * 注册一个新的 Manifest
   */
  register(manifest: PermissionManifest) {
    this.manifests.set(manifest.name, manifest);
    console.log(`[aether:manifest] Registered manifest: ${manifest.name}`);
  }

  getManifest(name: string): PermissionManifest | undefined {
    return this.manifests.get(name);
  }

  listManifests(): string[] {
    return Array.from(this.manifests.keys());
  }
}
