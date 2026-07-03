#!/usr/bin/env -S node --import tsx
/**
 * aether-audit — Council Verdict Phase 3 (Trust Trajectory CLI)
 * =============================================================
 * Operationalizes the HMAC-SHA256 hash-chained audit log.
 *
 *   aether-audit log   <action> <category> <outcome>   write an audit entry
 *   aether-audit list  [--limit N] [--json]           recent audit entries
 *   aether-audit verify                                verify hash-chain integrity (SOC2)
 *   aether-audit stats                                per-category counts
 *   aether-audit export <path>                        export a single-file verifiable artifact
 *
 * Environment: AUDIT_SIGNING_KEY (or AUDIT_SIGNING_KEY_FILE), AUDIT_LOG_DIR.
 * The signing key is required (>= 32 chars) — there is no default.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATEWAY_SRC = join(__dirname, '..', 'src');

const { AuditLogger } = await import(`${GATEWAY_SRC}/audit/logger.ts`);

// ── Arg parsing ─────────────────────────────────────────────────────────────

function usage() {
  console.log(`aether-audit — trust-trajectory CLI for Aether Gateway

Usage:
  aether-audit log <action> <category> <outcome> [--detail <text>] [--resource-type <T> --resource-id <I>]
  aether-audit list [--limit N] [--json]
  aether-audit verify
  aether-audit stats
  aether-audit export <output-path>

Categories: authentication | authorization | data_access | configuration | security | agent_execution | vault_operation | network | system
Outcomes:   success | failure | partial

Env:
  AUDIT_LOG_DIR          audit log directory (default: ./runtime/audit)
  AUDIT_SIGNING_KEY      HMAC signing key (>= 32 chars, required)
  AUDIT_SIGNING_KEY_FILE path to a file containing the key
`);
}

function parseArgs(argv) {
  const [sub, ...rest] = argv;
  const opts = { sub, positional: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--limit') opts.limit = parseInt(rest[++i], 10);
    else if (a === '--detail') opts.detail = rest[++i];
    else if (a === '--resource-type') opts.resourceType = rest[++i];
    else if (a === '--resource-id') opts.resourceId = rest[++i];
    else if (a === '--json') opts.json = true;
    else if (a.startsWith('--')) { console.error(`Unknown flag: ${a}`); process.exit(2); }
    else opts.positional.push(a);
  }
  return opts;
}

// ── Lazy logger ──────────────────────────────────────────────────────────────

let _logger = null;
function logger() {
  if (!_logger) {
    _logger = new AuditLogger();
  }
  return _logger;
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdLog(opts) {
  const [action, category, outcome] = opts.positional;
  if (!action || !category || !outcome) {
    console.error('Usage: aether-audit log <action> <category> <outcome>');
    process.exit(2);
  }
  const entry = {
    action,
    category,
    actor: { type: 'user', id: process.env.USER || 'cli-user', label: 'aether-audit CLI' },
    outcome,
  };
  if (opts.detail) entry.detail = opts.detail;
  if (opts.resourceType && opts.resourceId) {
    entry.resource = { type: opts.resourceType, id: opts.resourceId };
  }
  const id = logger().log(entry);
  logger().forceFlush(); // make the entry durable before we report success
  console.log(`✓ Audit entry written: ${id}`);
  console.log(`  action=${action} category=${category} outcome=${outcome}`);
  console.log(`  logDir=${logger().todayLogPath().replace(/\/\d{4}-\d{2}-\d{2}\.jsonl$/, '')}`);
}

async function cmdList(opts) {
  const entries = logger().recent(opts.limit ?? 20);
  if (opts.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  if (entries.length === 0) {
    console.log('(no audit entries in current buffer)');
    return;
  }
  console.log(`Recent audit entries (${entries.length} shown):`);
  for (const e of entries) {
    const detail = e.detail ? ` — ${e.detail}` : '';
    console.log(`  [${e.sequence}] ${e.timestamp}  ${e.category}/${e.action}  ${e.outcome}  ${e.actor.type}:${e.actor.id}${detail}`);
  }
}

async function cmdVerify() {
  const result = logger().verifyLogIntegrity();
  if (result.valid) {
    console.log(`✓ Integrity OK — ${result.entriesVerified} entries verified, hash chain intact.`);
  } else {
    console.log(`✗ Integrity FAILURE — ${result.entriesVerified} entries OK before first error:`);
    for (const err of result.errors) {
      console.log(`  - ${err}`);
    }
    process.exit(1);
  }
}

async function cmdStats() {
  const stats = logger().statsByCategory();
  const entries = Object.entries(stats);
  if (entries.length === 0) {
    console.log('(no audit entries in current buffer)');
    return;
  }
  console.log('Audit entries by category:');
  for (const [cat, count] of entries.sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.min(count, 40));
    console.log(`  ${cat.padEnd(18)} ${String(count).padStart(4)} ${bar}`);
  }
}

async function cmdExport(opts) {
  const [outputPath] = opts.positional;
  if (!outputPath) {
    console.error('Usage: aether-audit export <output-path>');
    process.exit(2);
  }

  const logFiles = logger().logFilePaths();
  const allEntries = [];
  for (const file of logFiles) {
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try { allEntries.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
    }
  }

  const signingKeyHash = createHash('sha256')
    .update(process.env.AUDIT_SIGNING_KEY || readKeyFromEnv())
    .digest('hex')
    .slice(0, 16);

  const artifact = {
    format: 'aether-audit-artifact',
    version: 1,
    exportedAt: new Date().toISOString(),
    generator: 'aether-audit CLI',
    signingKeyFingerprint: signingKeyHash,   // not the key itself
    entryCount: allEntries.length,
    sequenceRange: allEntries.length > 0
      ? { first: allEntries[0].sequence, last: allEntries[allEntries.length - 1].sequence }
      : null,
    headHash: allEntries.length > 0 ? allEntries[allEntries.length - 1].hash : 'GENESIS',
    logFiles: logFiles.map(f => f.split('/').pop()),
    entries: allEntries,
  };

  mkdirSync(dirname(resolve(outputPath)), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(artifact, null, 2) + '\n', 'utf-8');
  console.log(`✓ Exported ${allEntries.length} entries to ${outputPath}`);
  console.log(`  signingKeyFingerprint: ${signingKeyHash}`);
  console.log(`  headHash: ${artifact.headHash}`);
  console.log(`  Verify with: aether-audit verify`);
}

function readKeyFromEnv() {
  const f = process.env.AUDIT_SIGNING_KEY_FILE;
  if (f) {
    try { return readFileSync(f, 'utf-8').split(/[\r\n\0]/, 1)[0]; } catch { return ''; }
  }
  return '';
}

// ── Main ─────────────────────────────────────────────────────────────────────

const opts = parseArgs(process.argv.slice(2));

switch (opts.sub) {
  case 'log':   await cmdLog(opts); break;
  case 'list':  await cmdList(opts); break;
  case 'verify':await cmdVerify(); break;
  case 'stats': await cmdStats(); break;
  case 'export':await cmdExport(opts); break;
  case '--help':
  case '-h':
  case undefined:
    usage(); break;
  default:
    console.error(`Unknown subcommand: ${opts.sub}`); usage(); process.exit(2);
}
