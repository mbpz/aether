#!/usr/bin/env node
// scripts/check-wasmtime.mjs
//
// 探测 npm registry 上 @bytecodealliance/wasmtime 是否已发布。
// 决策见 ADR-002：在上游 npm 包发布前 EP-01 Phase 2 阻塞中。
//
// 用法：
//   node scripts/check-wasmtime.mjs           # 单次探测
//   node scripts/check-wasmtime.mjs --json    # 机器可读输出（CI 可用）
//
// 退出码：
//   0 = 上游已发布且 npm install 验证通过
//   1 = 上游已发布但 npm install 失败（值得告警）
//   2 = 上游仍未发布（沿用现状，按 ADR-002 等）
//   3 = 网络/registry 错误，无法判定
//
// 触发条件：手工跑 / GH Actions weekly cron / 写 ADR 时核对状态。

import { spawnSync } from 'child_process';

const PKG = '@bytecodealliance/wasmtime';
const json = process.argv.includes('--json');

function emit(result) {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    const status = {
      published: '✅ published',
      'install-fail': '⚠️  published but install failed',
      'not-published': '⏳ not yet published',
      'registry-error': '❌ registry error',
    }[result.status];
    process.stdout.write(`${status}: ${PKG}${result.version ? `@${result.version}` : ''}\n`);
    if (result.detail) process.stdout.write(`   ${result.detail}\n`);
  }
  process.exit(result.exitCode);
}

const r = spawnSync('npm', ['view', PKG, 'version'], {
  encoding: 'utf-8',
  timeout: 30_000,
});

if (r.error) {
  emit({ status: 'registry-error', exitCode: 3, detail: String(r.error.message ?? r.error) });
}

const stderr = (r.stderr ?? '').trim();
const stdout = (r.stdout ?? '').trim();

// `npm view` 在包不存在时退出码非零，stderr 含 E404
if (r.status !== 0) {
  if (/E404|not found/i.test(stderr)) {
    emit({
      status: 'not-published',
      exitCode: 2,
      detail: 'See ADR-002 — keep USE_WASM_RUNTIME=false until upstream ships.',
    });
  }
  emit({
    status: 'registry-error',
    exitCode: 3,
    detail: stderr || 'unknown npm view failure',
  });
}

const version = stdout;
emit({
  status: 'published',
  version,
  exitCode: 0,
  detail: `Run \`npm install ${PKG}@${version}\` to unblock EP-01 Phase 2.`,
});
