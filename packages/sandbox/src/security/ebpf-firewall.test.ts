// EbpfFirewall contract lock tests
// 锁定现有行为的合约，让 B5 的 EbpfPolicySync 可以基于稳定 API 工作。
// 风格参考 packages/sandbox/src/runtime/firecracker.test.ts：no beforeEach，per-test 构造。
import { describe, it, expect } from 'vitest';
import { EbpfFirewall } from './ebpf-firewall.js';

describe('EbpfFirewall', () => {
  it('default-deny returns allowed=false on unmatched host', () => {
    const fw = new EbpfFirewall({ defaultAction: 'block' });
    const r = fw.checkConnection({
      protocol: 'tcp',
      remoteAddress: '8.8.8.8',
      remotePort: 443,
      direction: 'egress',
    });
    expect(r.allowed).toBe(false);
  });

  it('explicit allow rule returns allowed=true for the matching host:port', () => {
    // 用 default rules 之外的 host（127.0.0.1/localhost 已被默认 allow 规则覆盖）
    const fw = new EbpfFirewall({ defaultAction: 'block' });
    const rule = fw.addRule({
      action: 'allow',
      protocol: 'all',
      host: '203.0.113.10',
      port: 443,
      direction: 'egress',
    });
    const r = fw.checkConnection({
      protocol: 'tcp',
      remoteAddress: '203.0.113.10',
      remotePort: 443,
      direction: 'egress',
    });
    expect(r.allowed).toBe(true);
    expect(r.matchedRule?.id).toBe(rule.id);
  });

  it('addRule + removeRule flips the verdict back to default-deny', () => {
    const fw = new EbpfFirewall({ defaultAction: 'block' });
    const target = '203.0.113.10';
    const rule = fw.addRule({
      action: 'allow',
      protocol: 'all',
      host: target,
      direction: 'egress',
    });

    expect(
      fw.checkConnection({ protocol: 'tcp', remoteAddress: target, direction: 'egress' }).allowed,
    ).toBe(true);

    fw.removeRule(rule.id);

    expect(
      fw.checkConnection({ protocol: 'tcp', remoteAddress: target, direction: 'egress' }).allowed,
    ).toBe(false);
  });

  it('getRules() returns a copy: mutating the result does not affect internal state', () => {
    const fw = new EbpfFirewall();
    const initialLen = fw.getRules().length;
    const snapshot = fw.getRules();
    (snapshot as unknown[]).length = 0;
    expect(fw.getRules().length).toBe(initialLen);
  });

  it('logConnection records an entry retrievable via getLogs(1)', () => {
    const fw = new EbpfFirewall({ defaultAction: 'block', logConnections: true });
    fw.logConnection({
      action: 'blocked',
      protocol: 'tcp',
      remoteAddress: '8.8.8.8',
      remotePort: 443,
      reason: 'default-deny',
    });
    const logs = fw.getLogs(1);
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe('blocked');
    expect(logs[0].remoteAddress).toBe('8.8.8.8');
  });

  it('emit("connection") fires on every logConnection call', async () => {
    const fw = new EbpfFirewall();
    const events: string[] = [];
    fw.on('connection', (e) => events.push(e.action));
    fw.logConnection({ action: 'allowed', protocol: 'tcp', remoteAddress: '1.1.1.1', remotePort: 80 });
    fw.logConnection({ action: 'blocked', protocol: 'tcp', remoteAddress: '2.2.2.2', remotePort: 80 });
    // EventEmitter fires synchronously on emit, but vi schedule may defer
    await new Promise(r => setTimeout(r, 5));
    expect(events).toEqual(['allowed', 'blocked']);
  });
});
