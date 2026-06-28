---
slug: /modules/skill-loader
title: Skill Loader
sidebar_label: Skill Loader
---

# Skill Loader Module

`@aether/skill-loader` parses, validates, and serves AI agent
"skills" — declarative descriptions of what an agent can do.

## What's in the box

| Class / function | What it does |
|-----------------|---------------|
| `SkillParser` | Parses a SKILL.md file (Markdown + frontmatter). Extracts metadata, system prompt, code, dependencies. |
| `SkillRegistry` | Progressive disclosure: `listLevel1()` returns metadata, `getLevel2()` adds instructions, `getLevel3()` returns the full record including code. |
| `SkillSecurityAuditor` | Static security scan. Computes a 0-100 trust score. Skills below threshold are rejected at registration. |
| `SecurityScorer` | ZTA (Zero-Trust Audit) scoring — heuristic + LLM-extensible. See ADR-007 for the avg/min semantics. |
| `SkillpackLockLoader` | Loads `.skillpack-lock.json` for dependency resolution. |
| `BountyManager` | Skill submission bounty system (used by the demo workflow). |
| `ReviewWorkflow` | Multi-reviewer skill review state machine. |
| `Marketplace` | Skill marketplace registry. |
| `ManuSImporter` | Imports Manus-format skill files. |
| `OpenclawMigrator` | Migrates OpenClaw-format plugin files. |
| `FormatConverter` | Converts between Manus / OpenClaw / Aether SKILL.md formats. |
| `FormatDetector` | Heuristic format detection (used by `FormatConverter`). |

## SKILL.md format

```markdown
---
name: my-skill
version: 1.0.0
description: A short description
category: developer
author: alice
tags: [coding, refactor]
---

# my-skill

## System Prompt

You are an agent that does X.

## Code

```javascript
return { ok: true, output: 42 };
```

## Dependencies

- skillpack/utils@1.0.0
```

A skill is loaded as `Level 1` (just metadata), `Level 2` (metadata +
system prompt), or `Level 3` (full record including code) based on
the agent's current needs. This three-tier model saves tokens — a
planning step doesn't need the code.

## Tests

```
packages/skill-loader/src/
├── parser/skill-parser.test.ts                8 tests
├── parser/skilllock-loader.test.ts            12 tests
├── registry/registry.test.ts                   9 tests
├── review-workflow.test.ts                    13 tests
├── bounty.test.ts                              8 tests
├── audit/security-scorer.test.ts             42 tests
└── audit/skill-auditor.test.ts                 (existing)
```

## See also

- [Format converter test coverage](https://github.com/aether/aether/tree/main/packages/skill-loader/src/format-converter.test.ts)
- [Demo skills in `examples/skills/`](https://github.com/aether/aether/tree/main/examples/skills)
