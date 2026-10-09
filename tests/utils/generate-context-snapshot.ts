#!/usr/bin/env tsx
/**
 * Context Snapshot Generator
 *
 * Generates a markdown file with all SSOT data needed for AI exploratory testing.
 * All data sourced from kernel — zero duplicate specs.
 *
 * Output: tests/test-context-snapshot.md (gitignored)
 * Run: cd tests && npm run test:context
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { PRICING_LIMITS_SSOT } from '@kernel/policies/pricing.policy';
import { TEST_USERS_CONFIG } from '@kernel/config/test-users.config';
import { buildRolePermissions } from '../smoke/_rbac-matrix';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateSnapshot(): string {
  const lines: string[] = [];
  const now = new Date().toISOString().split('T')[0];

  lines.push(`# Test Context Snapshot`);
  lines.push(`> Auto-generated: ${now} | Do NOT edit manually | Regenerate: \`npm run test:context\``);
  lines.push('');

  lines.push('## API Endpoints (ROUTES_API)');
  lines.push('');
  const routeEntries = Object.entries(ROUTES_API) as [string, string][];
  lines.push(`Total: **${routeEntries.length}** endpoints`);
  lines.push('');
  lines.push('| Key | Path |');
  lines.push('|-----|------|');
  for (const [key, routePath] of routeEntries) {
    lines.push(`| ${key} | \`${routePath}\` |`);
  }
  lines.push('');

  const { baseEvents, stylistEvents, clientEvents } = buildRolePermissions();

  lines.push('## RBAC Permissions');
  lines.push('');

  lines.push('### BASE (everyone, including not logged in)');
  lines.push('```');
  for (const p of baseEvents) { lines.push(p); }
  lines.push('```');
  lines.push('');

  lines.push('### STYLIST (base + logged + stylist-specific)');
  lines.push('```');
  for (const p of stylistEvents) {
    if (!baseEvents.has(p)) lines.push(p);
  }
  lines.push('```');
  lines.push('');

  lines.push('### CLIENT (base + logged + client-specific)');
  lines.push('```');
  for (const p of clientEvents) {
    if (!baseEvents.has(p)) lines.push(p);
  }
  lines.push('```');
  lines.push('');

  lines.push('## Pricing Limits (PRICING_LIMITS_SSOT)');
  lines.push('');
  const planNames = Object.keys(PRICING_LIMITS_SSOT) as (keyof typeof PRICING_LIMITS_SSOT)[];
  const limitKeys = Object.keys(PRICING_LIMITS_SSOT.FREE) as (keyof typeof PRICING_LIMITS_SSOT.FREE)[];

  lines.push(`| Limit | ${planNames.join(' | ')} |`);
  lines.push(`|-------|${planNames.map(() => '------').join('|')}|`);
  for (const key of limitKeys) {
    const values = planNames.map(plan => String(PRICING_LIMITS_SSOT[plan][key]));
    lines.push(`| ${key} | ${values.join(' | ')} |`);
  }
  lines.push('');

  lines.push('## System Roles (SystemRoleId)');
  lines.push('');
  lines.push('| Role | ID |');
  lines.push('|------|----|');
  for (const [name, id] of Object.entries(SystemRoleId)) {
    lines.push(`| ${name} | ${id} |`);
  }
  lines.push('');

  lines.push('## Test Users');
  lines.push('');
  lines.push('| Role | Email |');
  lines.push('|------|-------|');
  lines.push(`| STYLIST | \`${TEST_USERS_CONFIG.STYLIST.email}\` |`);
  lines.push(`| CLIENT | \`${TEST_USERS_CONFIG.CLIENT.email}\` |`);
  lines.push(`| ADMIN | \`$MASTER_ADMIN_EMAIL\` (from .env.test) |`);
  lines.push('');

  lines.push('## Kernel SSOT Sources');
  lines.push('');
  lines.push('| Data | File |');
  lines.push('|------|------|');
  lines.push('| Endpoints | `.shared-kernel/domain/routing/routing.config.ts` (ROUTES_API) |');
  lines.push('| Permissions | `.shared-kernel/application/role-permissions.ts` |');
  lines.push('| Validators | `.shared-kernel/policies/validation.policy.ts` + `validation/*.validation.ts` |');
  lines.push('| HTTP methods | Handler files: `web-1/src/pages/api/v1/[endpoint]/index.ts` (contestedHTTPMethod) |');
  lines.push('| Pricing limits | `.shared-kernel/policies/pricing.policy.ts` |');
  lines.push('| Test users | `.shared-kernel/config/test-users.config.ts` |');
  lines.push('');

  return lines.join('\n');
}

const snapshot = generateSnapshot();
const outputPath = path.resolve(__dirname, '../test-context-snapshot.md');
fs.writeFileSync(outputPath, snapshot, 'utf-8');

const lineCount = snapshot.split('\n').length;
console.log(`\n✅ Context snapshot generated: ${outputPath}`);
console.log(`   ${lineCount} lines | ${Object.keys(ROUTES_API).length} endpoints`);
