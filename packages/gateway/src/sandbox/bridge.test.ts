// Bridge fail-closed regression tests
// 验证 isolated-vm 不可用时绝不降级到主机级 JS 求值。
//
// 这些是静态结构性检查（grep 源码 + import 接口断言），故意不跑动态 sandbox：
// 1) 动态测要起 queue + audit + interval，开销大；
// 2) 我们要防的是"未来某次重构悄悄加回 new Function"——静态检查比动态测更早抓住。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bridgePath = join(__dirname, 'bridge.ts');
const bridgeSource = readFileSync(bridgePath, 'utf-8');

describe('SandboxBridge fail-closed (Batch 1 / safe-eval removal)', () => {
  it('no `new Function(` call survives in source', () => {
    // ESLint disable comments may mention "no-new-func"——只看实际调用。
    const matches = bridgeSource.match(/\bnew\s+Function\s*\(/g);
    expect(matches, `new Function(...) found in bridge.ts: ${matches?.join(', ')}`).toBeNull();
  });

  it('no `runSafeEval` symbol survives in source', () => {
    expect(bridgeSource.includes('runSafeEval')).toBe(false);
  });

  it('no `safe-eval` package import survives', () => {
    expect(bridgeSource).not.toMatch(/from\s+['"]safe-eval['"]/);
    expect(bridgeSource).not.toMatch(/require\s*\(\s*['"]safe-eval['"]/);
  });

  it('isolated-vm load failure path returns refusal error message', () => {
    // 关键文案锚点——任何重构都得保留这段拒绝逻辑。
    expect(bridgeSource).toMatch(/refusing to execute code in an[\s\S]*unsafe fallback/);
  });

  it('module exports a test reset hook for forcing the unavailable state', () => {
    // 给后续动态测留接口；hook 名带 __unsafe 前缀强提示仅测试用。
    expect(bridgeSource).toMatch(/export\s+function\s+__unsafeResetIvmForTesting/);
  });
});
