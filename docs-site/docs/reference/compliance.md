---
slug: /reference/compliance
title: Compliance Reports
sidebar_label: Compliance
---

# Compliance Report Reference

Aether's `ComplianceReportGenerator` produces audit-grade reports
against four frameworks: **SOC 2**, **GDPR**, **HIPAA**, and
**ISO 27001**. (A `custom` framework is also supported for bespoke
compliance regimes.)

## Quick start

```bash
# Generate a SOC 2 report for the current calendar year.
TOKEN=$(kubectl -n aether-demo get secret aether-demo-gateway-auth \
  -o jsonpath='{.data.LOCAL_API_TOKEN}' | base64 -d)

curl -X POST "https://aether-demo.example.com/api/admin/compliance/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "framework": "SOC2",
    "period": { "start": "2026-01-01T00:00:00Z", "end": "2026-12-31T23:59:59Z" },
    "scope": "Aether demo gateway"
  }' | jq .
```

## Output shape

```typescript
interface ComplianceReport {
  id: string;             // unique per generation
  generatedAt: string;    // ISO 8601
  framework: 'SOC2' | 'GDPR' | 'HIPAA' | 'ISO27001' | 'custom';
  period: { start: string; end: string };
  scope: string;
  sections: ComplianceSection[];   // per-control status
  summary: {
    overallScore: number;          // 0-100, weighted by applicable
    controlsPassed: number;
    controlsFailed: number;
    controlsWarning: number;
    controlsNotApplicable: number;
    criticalFindings: number;
    highFindings: number;
    mediumFindings: number;
    lowFindings: number;
  };
  findings: ComplianceFinding[];
  recommendations: ComplianceRecommendation[];
  auditTrail: AuditTrailReference[];
}
```

## Framework details

### SOC 2 (Trust Service Criteria, 2017)

Documented in
[`packages/gateway/src/compliance/soc2-controls.ts`](https://github.com/aether/aether/blob/main/packages/gateway/src/compliance/soc2-controls.ts).
Covers CC1 (Control Environment) through CC9 (Risk Mitigation), with
sub-requirements. Each control becomes a `ComplianceSection` with
status `pass` / `fail` / `warning` / `not_applicable` based on the
audit log evidence in the period.

### GDPR

Implements the 7 principles from Article 5:
- Lawfulness, fairness, transparency
- Purpose limitation
- Data minimization
- Accuracy
- Storage limitation
- Integrity & confidentiality
- Accountability

Each maps to a control. Note: GDPR compliance requires external
process documentation (DPO, DPIA, ROPA) — Aether's report covers
*technical* controls only.

### HIPAA Security Rule (45 CFR § 164.308-312)

Implements administrative, physical, and technical safeguards:
- Access control (§164.308(a)(4))
- Audit controls (§164.308(a)(1)(ii)(D))
- Integrity controls (§164.308(a)(1)(ii)(B))
- Person or entity authentication (§164.308(a)(4)(ii)(B))
- Transmission security (§164.308(e)(1))

### ISO 27001:2013

Implements Annex A control objectives (A.5 through A.18).

## Tests

`packages/gateway/src/compliance/soc2-controls.test.ts` — 8 tests covering
the public lookup functions, the per-control shape, and the
parent/sub-requirement lookup.

`packages/gateway/src/compliance/report-generator.test.ts` — 8 tests
covering the top-level report shape, the framework dispatch (each of
SOC2/GDPR/HIPAA/ISO27001/custom), the summary math invariants
(`overallScore ∈ [0,100]`, per-status counts sum to `sections.length`),
and the audit-trail policy reference.

## Caveat

Aether's `ComplianceReportGenerator` is a **report generator**, not
a **certified auditor**. The reports it produces are technical
evidence summaries — useful as input to a real SOC 2 / GDPR / HIPAA
audit, but not a substitute for one. See
[SECURITY.md](../../community/security.md) for the production
posture; v1.0 will not be tagged without an external audit.
