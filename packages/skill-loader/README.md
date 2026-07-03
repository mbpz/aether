# @aether/skill-loader — Three-Tier Progressive Disclosure

> Load a SKILL.md once, pay tokens only for what the agent needs — measured
> ≥60% token reduction, reproducible benchmark in `examples/token-benchmark/`.

## The skill-loading problem

Every agent framework (Claude Code, OpenClaw, Codex, Manus) solves skills the
same way: **load the whole file**. A 5 KB skill with a 3 KB implementation
costs ~1,261 tokens on discovery — even though the agent only needs the
100-token metadata + 385-token instructions until execution time.

## Aether's disclosure model

```
Level 1 (always load, < 100 tokens)     ──  metadata: name, version, tags
Level 2 (on selection, ~500 tokens)     ──  instructions: prompt, schema, one example
Level 3 (on execution, rest)           ──  code body, deps, tests — loaded last
```

**Numbers** (reproducible — run `node examples/token-benchmark/run-benchmark.mjs`):

| Skill | Baseline (full) | Optimized (L1+L2) | Reduction |
|-------|:-:|:-:|:-:|
| data-analyst (5 KB) | 1,261 tokens | 486 tokens | **61.5%** |
| web-scraper (6 KB) | 1,528 tokens | 490 tokens | **67.9%** |
| ml-pipeline (10 KB) | 2,237 tokens | 344 tokens | **84.6%** |
| **Average** | | | **71.3%** |

## Standalone usage

```typescript
import { SkillParser } from '@aether/skill-loader';
import { detectFormat } from '@aether/skill-loader';

const parser = new SkillParser();

// Parse any SKILL.md variant (Aether native, Manus, OpenClaw, Skillpack)
const skill = parser.parseFromFile('./skills/data-analyst.md');

// Level 1 — always available, < 100 tokens.
console.log(skill.level1.name, skill.level1.tags);

// Level 2 — full instructions (~500 tokens).
console.log(skill.level2.systemPrompt);

// Level 3 — code + deps, loaded on demand.
console.log(skill.level3?.code);
```

## Format auto-detection + conversion

```typescript
import { detectFormat, convert } from '@aether/skill-loader';

const format = await detectFormat('./skills/web-scraper.md');
// → 'manus' | 'openclaw' | 'aether' | 'skillpack' | 'unknown'

// Convert Manus SKILL.md → Aether native
const aetherMd = await convert('./skills/web-scraper.md', { to: 'aether' });
```

## Security auditing

```typescript
import { SkillSecurityAuditor, scoreSecurity } from '@aether/skill-loader';

// Static audit of a skill file
const auditor = new SkillSecurityAuditor();
const report = await auditor.audit('./skills/suspicious.md');
// report.issues: Array<{ type, severity, detail }>

// Zero-Trust Audit score (0-100)
const score = await scoreSecurity('./skills/data-analyst.md');
```

## API surface (subpath exports)

| Import path | What you get |
|---|---|
| `@aether/skill-loader` | `SkillParser`, `Skill`, security audit, marketplace |
| `@aether/skill-loader/parser` | `SkillParser`, `Skill`, `SkillMetadata`, `SkillInstructions`, `SkillResources` |
| `@aether/skill-loader/audit` | `SkillSecurityAuditor` |

## CLI

```bash
npx skill-audit ./skills/my-skill.md
```

## Requirements

- Node.js ≥ 20 (no native bindings)
