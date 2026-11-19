#!/usr/bin/env node
// Runs the CSS guard rules over main (`npm run lint:css`, and tests/audit/css-guards.sh).
// Usage: node css-rules/run.mjs            whole workspace, with presence floors
//        node css-rules/run.mjs <files…>   only those files (workspace-relative), no floors
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCssRules } from './engine.mjs';
import { CSS_RULES } from './index.mjs';

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.slice(2).map(arg => path.relative(cwd, path.resolve(arg)).split(path.sep).join('/'));
const { findings, errors, sites } = runCssRules({ rules: CSS_RULES, cwd, only: only.length ? only : undefined });

for (const rule of CSS_RULES) {
  console.log(`  css/${rule.name.padEnd(28)} ${String(sites.get(rule.name) ?? 0).padStart(6)} sites  (${rule.presence.what})`);
}
for (const message of errors) {
  console.error(`✗ ERROR ${message}`);
}
for (const finding of findings) {
  console.error(`✗ ${finding.file}:${finding.line}  css/${finding.rule}  ${finding.message}`);
}
if (findings.length > 0 || errors.length > 0) {
  console.error(`✗ CSS GUARDS FAILED: ${findings.length} finding(s), ${errors.length} error(s)`);
  process.exit(1);
}
console.log(`✓ CSS guards passed (${CSS_RULES.length} rules)`);
