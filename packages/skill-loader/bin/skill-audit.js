#!/usr/bin/env -S node --import tsx
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SKILL_LOADER_ROOT = join(__dirname, '..');

const { SkillParser } = await import(`${SKILL_LOADER_ROOT}/src/parser/skill-parser.ts`);
const { SkillSecurityAuditor } = await import(`${SKILL_LOADER_ROOT}/src/audit/skill-auditor.ts`);
const auditor = new SkillSecurityAuditor();
const parser = new SkillParser();

function auditSkillFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const skill = parser.parseFromContent(content, 'unknown');
    const report = auditor.scan({
      content: skill.rawContent,
      frontmatter: skill.level1,
      skillId: skill.id,
      skillName: skill.level1.name,
      source: skill.source,
    });
    printReport(report);
    return report;
  } catch (err) {
    console.error(`Error auditing ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

function printReport(report) {
  const icon = report.allowed ? '✅' : '🚫';
  console.log(`\n${icon} ${report.skillName} (source=${report.source})`);
  console.log(`   Score: ${report.trustScore}/100 ${report.allowed ? '' : '[BLOCKED]'}`);
  if (report.issues.length > 0) {
    console.log('   Issues:');
    for (const issue of report.issues) {
      console.log(`     [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.description} ${issue.location ? `@ ${issue.location}` : ''}`);
    }
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: skill-audit --path <file-or-dir>');
  console.error('       skill-audit --path ./skills/my-skill/SKILL.md');
  console.error('       skill-audit --path ./skills/');
  process.exit(1);
}

const pathIdx = args.indexOf('--path');
if (pathIdx >= 0) {
  const target = args[pathIdx + 1];
  const stat = statSync(target);
  if (stat.isDirectory()) {
    const entries = readdirSync(target);
    for (const entry of entries) {
      const fullPath = join(target, entry);
      if (statSync(fullPath).isDirectory()) {
        try { auditSkillFile(join(fullPath, 'SKILL.md')); } catch { /* skip */ }
      } else if (extname(entry).toLowerCase() === '.md') {
        auditSkillFile(fullPath);
      }
    }
  } else {
    auditSkillFile(target);
  }
}