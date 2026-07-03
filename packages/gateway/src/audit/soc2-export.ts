// SOC2 Export Formatter — Council Verdict Phase 3 (Surpass Plan)
// Maps Aether's audit log categories to SOC2 CC1-CC9 Trust Service Criteria.

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

interface AuditRecord {
  id: string;
  timestamp: string;
  sequence: number;
  previousHash: string;
  hash: string;
  action: string;
  category: string;
  actor: { type: string; id: string; label?: string };
  outcome: 'success' | 'failure' | 'partial';
  detail?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SOC2ControlMapping {
  controlId: string;
  controlTitle: string;
  requirement: string;
  auditCategories: string[];          // which AuditActionCategory values map here
  evidenceFound: string[];            // actions seen for this control
  status: 'covered' | 'partial' | 'gap';
  lastEventAt: string | null;
}

export interface SOC2Export {
  format: 'aether-soc2-export';
  version: 1;
  generatedAt: string;
  period: { start: string; end: string; since?: string; until?: string };
  integrity: {
    valid: boolean;
    entriesVerified: number;
    errors: string[];
    headHash: string;
    signingKeyFingerprint: string;
    logFiles: string[];
  };
  controlCoverage: {
    total: number;
    covered: number;     // control has ≥1 matching audit event (full period)
    partial: number;     // control has evidence but with failures
    gap: number;         // no evidence at all
    controls: SOC2ControlMapping[];
  };
  entries: AuditRecord[];
}

// ── Audit-category → SOC2 control mapping ─────────────────────────────────────
// One audit category can map to multiple SOC2 controls. This is the bridge
// between runtime audit events and compliance evidence.

const CATEGORY_TO_CONTROLS: Record<string, string[]> = {
  authorization: ['CC6'],          // logical access
  authentication: ['CC6'],         // logical access
  data_access:    ['CC5', 'CC6'],  // control activities + logical access
  security:       ['CC5', 'CC7'],  // control activities + system operations
  agent_execution: ['CC4', 'CC5'], // monitoring + control activities
  configuration:  ['CC2', 'CC8'],  // communication + change management
  vault_operation: ['CC6', 'CC9'], // logical access + risk mitigation
  network:        ['CC7'],         // system operations
  system:         ['CC2', 'CC4'],  // communication + monitoring
};

const SOC2_CONTROLS: Array<{ id: string; title: string; requirements: string[] }> = [
  { id: 'CC1', title: 'Control Environment', requirements: ['CC1.1', 'CC1.2', 'CC1.3', 'CC1.4'] },
  { id: 'CC2', title: 'Communication',      requirements: ['CC2.1', 'CC2.2', 'CC2.3'] },
  { id: 'CC3', title: 'Risk Assessment',    requirements: ['CC3.1', 'CC3.2', 'CC3.3'] },
  { id: 'CC4', title: 'Monitoring',         requirements: ['CC4.1', 'CC4.2'] },
  { id: 'CC5', title: 'Control Activities', requirements: ['CC5.1', 'CC5.2', 'CC5.3'] },
  { id: 'CC6', title: 'Logical Access',     requirements: ['CC6.1', 'CC6.2', 'CC6.3', 'CC6.4', 'CC6.5'] },
  { id: 'CC7', title: 'System Operations',  requirements: ['CC7.1', 'CC7.2', 'CC7.3'] },
  { id: 'CC8', title: 'Change Management',  requirements: ['CC8.1', 'CC8.2', 'CC8.3'] },
  { id: 'CC9', title: 'Risk Mitigation',    requirements: ['CC9.1', 'CC9.2', 'CC9.3'] },
];

// ── Core export function ──────────────────────────────────────────────────────

export function buildSOC2Export(opts: {
  logDir: string;
  signingKey: string | null;
  since?: string;
  until?: string;
}): SOC2Export {
  const logFiles = _getLogFiles(opts.logDir);
  const allEntries = _readEntries(logFiles, opts.since, opts.until);

  // Integrity check.
  const errors: string[] = [];
  let entriesVerified = 0;
  let prev = 'GENESIS';
  for (const rec of allEntries) {
    if (rec.previousHash !== prev) {
      errors.push(`chain broken at seq=${rec.sequence}`);
      break;
    }
    prev = rec.hash;
    entriesVerified++;
  }

  const headHash: string = allEntries.length > 0 ? String(allEntries[allEntries.length - 1].hash) : 'GENESIS';
  const valid = errors.length === 0;

  // Control coverage.
  const allControlIds = new Set<string>();
  const evidenceByControl: Record<string, { actions: Set<string>; lastAt: string | null; failures: number }> = {};

  for (const entry of allEntries) {
    const controls = CATEGORY_TO_CONTROLS[entry.category] || [];
    for (const cid of controls) {
      allControlIds.add(cid);
      if (!evidenceByControl[cid]) evidenceByControl[cid] = { actions: new Set(), lastAt: null, failures: 0 };
      evidenceByControl[cid].actions.add(entry.action);
      evidenceByControl[cid].lastAt = entry.timestamp;
      if (entry.outcome === 'failure') evidenceByControl[cid].failures++;
    }
  }

  const controls: SOC2ControlMapping[] = SOC2_CONTROLS.map(ctrl => {
    const evidence = evidenceByControl[ctrl.id];
    const hasEvidence = !!evidence && evidence.actions.size > 0;
    const hasFailures = !!evidence && evidence.failures > 0;
    return {
      controlId: ctrl.id,
      controlTitle: ctrl.title,
      requirement: ctrl.requirements.join(', '),
      auditCategories: Object.entries(CATEGORY_TO_CONTROLS).filter(([, v]) => v.includes(ctrl.id)).map(([k]) => k),
      evidenceFound: evidence ? [...evidence.actions] : [],
      status: !hasEvidence ? 'gap' : hasFailures ? 'partial' : 'covered',
      lastEventAt: evidence?.lastAt ?? null,
    };
  });

  const covered = controls.filter(c => c.status === 'covered').length;
  const partial = controls.filter(c => c.status === 'partial').length;
  const gap     = controls.filter(c => c.status === 'gap').length;

  const signingKeyHash = opts.signingKey
    ? createHash('sha256').update(opts.signingKey).digest('hex').slice(0, 16)
    : 'no-key';

  return {
    format: 'aether-soc2-export',
    version: 1,
    generatedAt: new Date().toISOString(),
    period: {
      start: allEntries[0]?.timestamp ?? '',
      end: allEntries[allEntries.length - 1]?.timestamp ?? '',
      since: opts.since,
      until: opts.until,
    },
    integrity: {
      valid,
      entriesVerified,
      errors,
      headHash,
      signingKeyFingerprint: signingKeyHash,
      logFiles: logFiles.map(f => f.split('/').pop()!),
    },
    controlCoverage: {
      total: SOC2_CONTROLS.length,
      covered,
      partial,
      gap,
      controls,
    },
    entries: allEntries,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _getLogFiles(logDir: string): string[] {
  try {
    if (!require('fs').existsSync(logDir)) return [];
  } catch { return []; }
  return readdirSync(logDir)
    .filter((f: string) => f.endsWith('.jsonl'))
    .map((f: string) => join(logDir, f))
    .sort();
}

function _readEntries(files: string[], since?: string, until?: string): AuditRecord[] {
  const out: AuditRecord[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as AuditRecord;
        if (since && rec.timestamp < since) continue;
        if (until && rec.timestamp > until) continue;
        out.push(rec);
      } catch { /* skip */ }
    }
  }
  return out;
}
