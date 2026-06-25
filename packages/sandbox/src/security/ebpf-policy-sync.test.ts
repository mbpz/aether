// EbpfPolicySync tests — 验证 YAML 契约、原子写、防抖、fail-closed。
// 风格：per-test tmpdir + afterEach 清理（这是仓库首个用 afterEach 的文件，文件头注释解释原因）。
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { EbpfFirewall } from './ebpf-firewall.js';
import { EbpfPolicySync, serializeToPolicyYAML } from './ebpf-policy-sync.js';

describe('EbpfPolicySync', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'aether-ebpf-sync-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('writes a parseable YAML on start() that round-trips through js-yaml', () => {
    const fw = new EbpfFirewall();
    fw.addRules([
      { action: 'allow', protocol: 'all', host: '127.0.0.1', port: 80, direction: 'egress' },
      { action: 'block', protocol: 'all', host: '10.0.0.0/8', direction: 'egress' },
    ]);
    const target = join(workdir, 'policy.yaml');
    const sync = new EbpfPolicySync(fw, { policyPath: target, debounceMs: 10, failClosed: true });
    sync.start();
    sync.stop();

    const text = readFileSync(target, 'utf-8');
    const parsed = yaml.load(text) as { rules: Array<{ action: string; host: string; port?: number }> };
    expect(parsed.rules.length).toBeGreaterThanOrEqual(2);
    expect(parsed.rules.some(r => r.action === 'allow' && r.host === '127.0.0.1')).toBe(true);
    expect(parsed.rules.some(r => r.action === 'block' && r.host === '10.0.0.0/8')).toBe(true);
  });

  it('handles zero custom rules (after resetRules) — produces YAML with only default rules', () => {
    const fw = new EbpfFirewall();
    fw.resetRules();
    const target = join(workdir, 'policy.yaml');
    const sync = new EbpfPolicySync(fw, { policyPath: target, debounceMs: 10, failClosed: true });
    sync.start();
    sync.stop();
    const parsed = yaml.load(readFileSync(target, 'utf-8')) as { rules: unknown[] };
    // resetRules 重新 setDefaultRules — 应至少有 default-allow-localhost
    expect(parsed.rules.length).toBeGreaterThanOrEqual(1);
  });

  it('addRule after start triggers another write (within debounce window)', async () => {
    const fw = new EbpfFirewall();
    const target = join(workdir, 'policy.yaml');
    const sync = new EbpfPolicySync(fw, { policyPath: target, debounceMs: 50, pollIntervalMs: 50, failClosed: true });
    sync.start();

    const initialCount = sync.getWriteCount();

    // 加 default rules 之外的规则
    fw.addRule({ action: 'allow', protocol: 'all', host: '203.0.113.10', port: 443, direction: 'egress' });

    // 等待 debounce + poll tick
    await new Promise(r => setTimeout(r, 200));

    expect(sync.getWriteCount()).toBeGreaterThan(initialCount);
    sync.stop();
  });

  it('concurrent addRule calls collapse to a single write within debounce window', async () => {
    const fw = new EbpfFirewall();
    const target = join(workdir, 'policy.yaml');
    const sync = new EbpfPolicySync(fw, {
      policyPath: target,
      debounceMs: 50,
      pollIntervalMs: 20,
      failClosed: true,
      writeOnStart: false,
    });
    sync.start();

    expect(sync.getWriteCount()).toBe(0);

    for (let i = 0; i < 5; i++) {
      fw.addRule({ action: 'allow', protocol: 'all', host: `10.0.0.${i + 1}`, direction: 'egress' });
    }

    // Wait for poll + debounce + write (20 + 50 + overhead)
    await new Promise(r => setTimeout(r, 500));

    // All 5 adds should be collapsed into exactly 1 write
    expect(sync.getWriteCount()).toBe(1);
    expect(sync.isInSync()).toBe(true);
    sync.stop();
  });

  it('removeRule is reflected in the next write', async () => {
    const fw = new EbpfFirewall();
    const rule = fw.addRule({ action: 'allow', protocol: 'all', host: '203.0.113.99', direction: 'egress' });
    const target = join(workdir, 'policy.yaml');
    const sync = new EbpfPolicySync(fw, { policyPath: target, debounceMs: 50, pollIntervalMs: 50, failClosed: true });
    sync.start();

    const beforeRemove = yaml.load(readFileSync(target, 'utf-8')) as { rules: Array<{ id: string }> };
    expect(beforeRemove.rules.some(r => r.id === rule.id)).toBe(true);

    fw.removeRule(rule.id);
    await new Promise(r => setTimeout(r, 200));

    const afterRemove = yaml.load(readFileSync(target, 'utf-8')) as { rules: Array<{ id: string }> };
    expect(afterRemove.rules.some(r => r.id === rule.id)).toBe(false);
    sync.stop();
  });

  it('writes atomically — no .tmp files left in the target directory after a successful write', () => {
    const fw = new EbpfFirewall();
    const target = join(workdir, 'policy.yaml');
    const sync = new EbpfPolicySync(fw, { policyPath: target, debounceMs: 10, failClosed: true });
    sync.start();
    sync.stop();

    const files = readdirSync(workdir);
    const tmps = files.filter(f => f.endsWith('.tmp'));
    expect(tmps).toEqual([]);
    // target 必须存在且非空
    const st = statSync(target);
    expect(st.size).toBeGreaterThan(0);
  });

  it('fail-closed: unwritable policy path causes a throw on first write', () => {
    // 创建一个文件，policyPath 指到该文件 *里面* —— writeFileSync 写到 file 内部路径必定 EEXIST/ENOTDIR
    const blocker = join(workdir, 'blocker');
    writeFileSync(blocker, 'I am a file, not a directory');
    const target = join(blocker, 'policy.yaml'); // 试图把 blocker 当目录
    const fw = new EbpfFirewall();
    const sync = new EbpfPolicySync(fw, { policyPath: target, debounceMs: 10, failClosed: true });
    expect(() => sync.start()).toThrow();
  });

  it('preserves direction field and id in YAML output', () => {
    const fw = new EbpfFirewall();
    fw.addRule({
      action: 'block',
      protocol: 'udp',
      host: '8.8.8.8',
      port: 53,
      direction: 'ingress',
    });
    const target = join(workdir, 'policy.yaml');
    const sync = new EbpfPolicySync(fw, { policyPath: target, debounceMs: 10, failClosed: true });
    sync.start();
    sync.stop();
    const parsed = yaml.load(readFileSync(target, 'utf-8')) as {
      rules: Array<{ id: string; action: string; protocol: string; host: string; port: number; direction: string }>;
    };
    const blockRule = parsed.rules.find(r => r.host === '8.8.8.8');
    expect(blockRule).toBeDefined();
    expect(blockRule!.action).toBe('block');
    expect(blockRule!.protocol).toBe('udp');
    expect(blockRule!.port).toBe(53);
    expect(blockRule!.direction).toBe('ingress');
  });

  it('serializeToPolicyYAML normalizes "all" / "*" to empty/0', () => {
    const fw = new EbpfFirewall();
    fw.addRule({ action: 'allow', protocol: 'all', host: '127.0.0.1', port: '*', direction: 'egress' });
    const out = serializeToPolicyYAML(fw.getRules());
    const r = out.rules.find(x => x.host === '127.0.0.1')!;
    expect(r.protocol).toBe('');
    expect(r.port).toBe(0);
  });

  it('idempotent: stopping and restarting with no rule changes does not re-write', () => {
    const fw = new EbpfFirewall();
    const target = join(workdir, 'policy.yaml');
    const sync = new EbpfPolicySync(fw, { policyPath: target, debounceMs: 10, failClosed: true });
    sync.start();
    const firstCount = sync.getWriteCount();
    sync.stop();

    // 第二次启动，规则无变化 → 不应再写
    sync.start();
    const secondCount = sync.getWriteCount();
    sync.stop();

    expect(secondCount).toBe(firstCount);
  });

  it('idempotent: writeNow() called when already in sync is a no-op', () => {
    const fw = new EbpfFirewall();
    const target = join(workdir, 'policy.yaml');
    const sync = new EbpfPolicySync(fw, { policyPath: target, debounceMs: 10, failClosed: true });
    sync.start();
    const before = sync.getWriteCount();
    sync.writeNow();
    sync.writeNow();
    sync.writeNow();
    expect(sync.getWriteCount()).toBe(before);
    sync.stop();
  });
});
