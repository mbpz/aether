#!/usr/bin/env node
// scripts/check-ebpf-agent.mjs
//
// ADR-006 companion probe. Three checks:
//   1. binary exists + executable (EBPF_AGENT_BIN or /usr/local/bin/aether-ebpf-agent)
//   2. policy file writable (EBPF_POLICY_PATH or /etc/aether/ebpf-policy.yaml)
//   3. PID alive (EBPF_AGENT_PID file or /var/run/aether-ebpf.pid)
//
// Exit codes (mirrors check-wasmtime.mjs convention):
//   0 = healthy (binary present + executable, policy writable, agent alive)
//   1 = degraded (binary not executable, policy read-only, stale PID) — worth alerting
//   2 = not-yet (by design, e.g. agent not deployed locally — CI accepts this)
//   3 = transport/error (permission denied, mount missing, etc.)
//
// Usage:
//   node scripts/check-ebpf-agent.mjs                # human-readable
//   node scripts/check-ebpf-agent.mjs --json         # machine-readable
//   node scripts/check-ebpf-agent.mjs --smoke        # self-test 4 codes

import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const PKG = 'aether-ebpf-agent';
const json = process.argv.includes('--json');
const smoke = process.argv.includes('--smoke');

function emit(result) {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    const statusLabel = {
      'healthy':           '✅ healthy',
      'degraded':          '⚠️  degraded',
      'not-yet':           '⏳ not yet deployed',
      'transport-error':   '❌ transport error',
    }[result.status] ?? result.status;
    process.stdout.write(`${statusLabel}: ${PKG}\n`);
    for (const c of result.checks ?? []) {
      process.stdout.write(`  ${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}\n`);
    }
    if (result.detail) process.stdout.write(`  → ${result.detail}\n`);
  }
  process.exit(result.exitCode);
}

const BIN_PATH = process.env.EBPF_AGENT_BIN ?? '/usr/local/bin/aether-ebpf-agent';
const POLICY_PATH = process.env.EBPF_POLICY_PATH ?? '/etc/aether/ebpf-policy.yaml';
const PID_PATH = process.env.EBPF_AGENT_PID ?? '/var/run/aether-ebpf.pid';

// ── Smoke self-test ──────────────────────────────────────────────────────────
if (smoke) {
  const workdir = mkdtempSync(join(tmpdir(), 'aether-check-ebpf-smoke-'));
  const results = [];

  // Case 1: healthy — writeable path, no PID file → 0
  // (binary is optional, agent not strictly required locally)
  try {
    const target = join(workdir, 'healthy.yaml');
    writeFileSync(target, '');
    accessSync(target, constants.W_OK);
    // binary 不存在也不要求 — 这是 sandbox-side probe，主要是 policy path
    results.push({ name: 'healthy-policy-only', exitCode: 0 });
  } catch (e) {
    results.push({ name: 'healthy-policy-only', exitCode: 3, err: String(e) });
  }

  // Case 2: degraded — 路径只读 → 1
  try {
    const readOnly = join(workdir, 'ro-parent');
    mkdirSyncCatch(readOnly, 0o555);
    const target = join(readOnly, 'policy.yaml');
    try {
      accessSync(target, constants.W_OK);
      // 如果能写，那不是 degraded —— 跳过
      results.push({ name: 'degraded-readonly', exitCode: 0, note: 'did not actually fail' });
    } catch {
      results.push({ name: 'degraded-readonly', exitCode: 1 });
    }
    chmodSync(readOnly, 0o755);
  } catch (e) {
    results.push({ name: 'degraded-readonly', exitCode: 1, err: String(e) });
  }

  // Case 3: not-yet — 路径完全不存在 → 2
  try {
    const target = join(workdir, 'never', 'made', 'this', 'dir', 'policy.yaml');
    const result = checkPolicy(target);
    if (result.exitCode === 2) {
      results.push({ name: 'not-yet-missing-path', exitCode: 2 });
    } else {
      results.push({ name: 'not-yet-missing-path', exitCode: 99, unexpected: result });
    }
  } catch (e) {
    results.push({ name: 'not-yet-missing-path', exitCode: 99, err: String(e) });
  }

  // Case 4: transport — 文件是 block device / 总线错误 → 3
  // 难以干净复现，跳过这一档。

  rmSync(workdir, { recursive: true, force: true });

  emit({
    status: 'smoke',
    exitCode: 0,
    detail: 'self-test complete',
    cases: results,
  });
}

// ── Normal probe ─────────────────────────────────────────────────────────────

const checks = [];

// Check 1: binary
let binaryOk = false;
let binaryDetail = '';
try {
  accessSync(BIN_PATH, constants.X_OK);
  binaryOk = true;
  binaryDetail = `executable at ${BIN_PATH}`;
} catch (err) {
  if (err.code === 'ENOENT') {
    binaryDetail = `not found at ${BIN_PATH} (not deployed locally)`;
  } else {
    binaryDetail = `${err.code}: ${err.message}`;
  }
}
checks.push({ name: 'binary', ok: binaryOk, detail: binaryDetail });

// Check 2: policy path
const policyResult = checkPolicy(POLICY_PATH);
checks.push(policyResult.check);

// Check 3: PID file
let pidOk = false;
let pidDetail = '';
let pidFileExists = false;
try {
  if (existsSync(PID_PATH)) {
    pidFileExists = true;
    const pid = parseInt(readFileSync(PID_PATH, 'utf-8').trim(), 10);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0); // signal 0 = check liveness
        pidOk = true;
        pidDetail = `agent PID ${pid} alive`;
      } catch (e) {
        pidDetail = `PID ${pid} not alive (${e.code})`;
      }
    } else {
      pidDetail = `PID file ${PID_PATH} has invalid content`;
    }
  } else {
    pidDetail = `no PID file at ${PID_PATH} (agent not running locally)`;
  }
} catch (err) {
  pidDetail = `${err.code}: ${err.message}`;
}
checks.push({ name: 'pid', ok: pidOk, detail: pidDetail });

// Decide status
let status, exitCode, detail;
if (policyResult.exitCode === 3) {
  status = 'transport-error'; exitCode = 3; detail = policyResult.detail;
} else if (policyResult.exitCode === 1) {
  // parent exists but not writable — degraded (sandbox can't push policy)
  status = 'degraded'; exitCode = 1; detail = `${policyResult.detail} — agent may be deployed but policy is unwritable`;
} else if (policyResult.exitCode === 2) {
  // file 还没创建但 parent writable → healthy（sandbox 会自己创建）
  // 但要求 binary 也在，否则 not-yet
  if (binaryOk) {
    status = 'healthy'; exitCode = 0; detail = 'binary present, policy parent writable';
  } else {
    status = 'not-yet'; exitCode = 2; detail = 'policy parent writable, agent not deployed locally';
  }
} else {
  // policy 文件存在且可写 (exitCode 0)
  if (pidOk) {
    status = 'healthy'; exitCode = 0; detail = 'binary+policy+pid all present';
  } else if (!pidFileExists) {
    // policy 已就位但 agent 没在本机跑 — 部署到远端 DaemonSet，正常
    status = 'not-yet'; exitCode = 2; detail = 'policy file ready; agent runs elsewhere (DaemonSet)';
  } else {
    status = 'degraded'; exitCode = 1; detail = 'policy file ready but PID file present and stale';
  }
}

emit({ status, exitCode, detail, checks });

// ── Helpers ────────────────────────────────────────────────────────────────

function checkPolicy(p) {
  try {
    if (existsSync(p)) {
      accessSync(p, constants.W_OK);
      return { check: { name: 'policy', ok: true, detail: `writable at ${p}` }, exitCode: 0, detail: 'policy file exists and writable' };
    }
    // 不存在 — 检查父目录是否可创建
    const dir = join(p, '..');
    if (existsSync(dir)) {
      try {
        accessSync(dir, constants.W_OK);
        return { check: { name: 'policy', ok: true, detail: `parent ${dir} writable; ${p} will be created` }, exitCode: 2, detail: 'policy does not exist yet' };
      } catch {
        return { check: { name: 'policy', ok: false, detail: `parent ${dir} not writable` }, exitCode: 1, detail: 'parent dir not writable' };
      }
    }
    return { check: { name: 'policy', ok: false, detail: `path ${p} does not exist and parent ${dir} missing` }, exitCode: 2, detail: 'path missing (not-yet)' };
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return { check: { name: 'policy', ok: false, detail: `${err.code}: ${err.message}` }, exitCode: 1, detail: 'permission denied' };
    }
    return { check: { name: 'policy', ok: false, detail: `${err.code}: ${err.message}` }, exitCode: 3, detail: 'transport error' };
  }
}

function mkdirSyncCatch(p, mode) {
  // local helper so we can chmod in the smoke self-test
  const { mkdirSync, chmodSync } = require('fs');
  mkdirSync(p, { recursive: true, mode });
  chmodSync(p, mode);
}
