// Manifest Engine - 权限清单审计引擎
// 所有外部输入必须通过 Manifest 验证才能执行

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

// Forward-declare to avoid circular import — AuditLogger is optional at runtime.
type AuditLoggerLike = {
  log(entry: {
    action: string;
    category: string;
    actor: { type: string; id: string };
    outcome: string;
    detail?: string;
    metadata?: Record<string, unknown>;
  }): string;
};

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

/**
 * Check whether a target hostname/URL is permitted by an entry in
 * `allowedHosts`. Entry syntax:
 *   - exact host:   `api.openai.com`
 *   - exact IP:     `10.0.0.1`
 *   - IPv4 CIDR:    `10.0.0.0/8`
 *   - domain suffix: `*.openai.com`  (matches `api.openai.com` but NOT
 *                                       `openai.com.evil.example` or
 *                                       `evil-openai.com`)
 *
 * The function deliberately avoids `String.includes`, which would let
 * attackers bypass the allowlist with names like
 * `evil-127.0.0.1.attacker.com`.
 */
export function hostMatchesAllowlist(target: string, allowed: string[]): boolean {
  if (allowed.length === 0) return false;

  // Extract hostname from a URL or use the value directly if it is already
  // a bare hostname/IP. We lowercase the result so case mismatches don't
  // become an evasion vector.
  const lowerTarget = target.trim().toLowerCase();
  let hostname = lowerTarget;
  try {
    // URL parsing requires a scheme; prepend one if missing so bare hosts
    // still parse.
    const candidate = lowerTarget.includes('://') ? lowerTarget : `http://${lowerTarget}`;
    const u = new URL(candidate);
    hostname = u.hostname.toLowerCase();
  } catch {
    // Not a parseable URL; treat the whole string as the host literal.
  }

  for (const rawEntry of allowed) {
    const entry = rawEntry.trim().toLowerCase();
    if (entry.length === 0) continue;

    // Domain-suffix match: `*.example.com`
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(2);
      if (suffix.length === 0) continue;
      // Must be a suffix of the hostname AND separated by a dot boundary
      // (so `*.example.com` does not match `evil-example.com`).
      if (hostname === suffix) continue; // bare apex is not a sub-domain
      if (hostname.endsWith('.' + suffix)) return true;
      continue;
    }

    // IPv4 CIDR: `10.0.0.0/8`
    if (entry.includes('/')) {
      if (ipv4InCidr(hostname, entry)) return true;
      continue;
    }

    // IPv4 single address
    if (isIPv4(hostname) && isIPv4(entry) && hostname === entry) return true;

    // Exact host match (lowercased, no suffix/prefix tricks).
    if (hostname === entry) return true;
  }

  return false;
}

function isIPv4(s: string): boolean {
  const parts = s.split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

function ipv4ToInt(s: string): number {
  const parts = s.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [base, prefixStr] = cidr.split('/');
  if (!isIPv4(ip) || !isIPv4(base)) return false;
  const prefix = Number(prefixStr);
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false;
  if (prefix === 0) return true;
  const mask = (~0 << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

export class ManifestEngine {
  private manifests: Map<string, PermissionManifest> = new Map();
  private audit: AuditLoggerLike | null = null;
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

  constructor(audit?: AuditLoggerLike) {
    this.audit = audit ?? null;
    this.loadManifestsFromDir();
  }

  /** Wire an audit logger after construction (for circular-dependency cases). */
  setAuditLogger(audit: AuditLoggerLike | null): void {
    this.audit = audit;
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

    let result: ManifestValidationResult;

    // 检查操作类型
    if (request.operation === 'exec' && !manifest.operations?.exec) {
      result = { allowed: false, reason: 'exec operations are not permitted by manifest', manifest };
    } else if (request.operation === 'network') {
      if (!manifest.operations?.network) {
        result = { allowed: false, reason: 'network operations are not permitted by manifest', manifest };
      } else if (request.target && manifest.network?.blockExternal) {
        const allowedHosts = manifest.network.allowedHosts ?? [];
        const isAllowed = hostMatchesAllowlist(request.target, allowedHosts);
        if (!isAllowed) {
          result = {
            allowed: false,
            reason: `network target ${request.target} is not in allowedHosts`,
            manifest,
          };
        } else {
          result = { allowed: true, manifest };
        }
      } else {
        result = { allowed: true, manifest };
      }
    } else if (request.operation === 'filesystem' && !manifest.operations?.filesystem) {
      result = { allowed: false, reason: 'filesystem operations are not permitted by manifest', manifest };
    } else {
      result = { allowed: true, manifest };
    }

    // Auto-record authorization decision (B15 — lifecycle audit).
    // Best-effort: never throw from the audit path, and never block the
    // validation decision on audit availability.
    if (this.audit) {
      try {
        this.audit.log({
          action: result.allowed ? 'manifest_allow' : 'manifest_reject',
          category: 'authorization',
          actor: { type: 'system', id: 'manifest-engine' },
          outcome: result.allowed ? 'success' : 'failure',
          detail: `operation=${request.operation} manifest=${manifest.name} allowed=${result.allowed}`,
          metadata: {
            operation: request.operation,
            target: request.target,
            manifestName: manifest.name,
            reason: result.reason ?? null,
          },
        });
      } catch {
        // Audit failure must not break validation.
      }
    }

    return result;
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
