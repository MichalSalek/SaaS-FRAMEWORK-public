#!/usr/bin/env tsx
/**
 * API Test Coverage Checker
 *
 * Compares ROUTES_API (kernel SSOT) with smoke tests.
 * Reports untested endpoints with priority levels.
 */

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);

function collectEndpointsFromFiles(files: string[]): string[] {
  const endpoints: string[] = [];
  const endpointPattern = /endpoint:\s*['"]([^'"]+)['"]/g;
  for (const file of files) {
    try {
      const source = readFileSync(file, 'utf-8');
      let _match: RegExpExecArray | null;
      while ((_match = endpointPattern.exec(source)) !== null) {
        if (!endpoints.includes(_match[1])) {
          endpoints.push(_match[1]);
        }
      }
    } catch { /* skip unreadable files */ }
  }
  return endpoints;
}

const smokeDir = path.resolve(__dirname_local, '../smoke');
const smokeFiles = readdirSync(smokeDir)
  .filter(f => f.endsWith('.ts'))
  .map(f => path.join(smokeDir, f));

const SMOKE_TEST_ENDPOINTS = collectEndpointsFromFiles([
  path.resolve(__dirname_local, '../run-smoke-tests.ts'),
  ...smokeFiles,
]);

type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

function classifyPriority(routeKey: string): Priority {
  if (routeKey.includes('DELETE') || routeKey.includes('DISABLE')) return 'CRITICAL';
  if (routeKey.includes('PAYMENT') || routeKey.includes('PRICING') || routeKey.includes('STRIPE')) return 'CRITICAL';
  if (routeKey.includes('SESSION') || routeKey.includes('LOGIN')) return 'HIGH';
  if (routeKey.includes('CREATE') || routeKey.includes('UPDATE') || routeKey.includes('SET_')) return 'HIGH';
  if (routeKey.includes('ADMIN') || routeKey.includes('GET_ALL')) return 'MEDIUM';
  return 'LOW';
}

function runCoverageCheck() {
  console.log('📊 API TEST COVERAGE CHECKER\n');
  console.log('='.repeat(80));

  const smokeSet = new Set(SMOKE_TEST_ENDPOINTS);
  const allRoutes = Object.entries(ROUTES_API);

  type CoverageEntry = {
    routeKey: string;
    endpoint: string;
    smoke: boolean;
    priority: Priority;
  };

  const coverage: CoverageEntry[] = allRoutes.map(([routeKey, endpoint]) => ({
    routeKey,
    endpoint,
    smoke: smokeSet.has(endpoint),
    priority: classifyPriority(routeKey),
  }));

  const total = coverage.length;
  const smokeCount = coverage.filter(c => c.smoke).length;
  const untestedCount = total - smokeCount;

  console.log(`\n📈 OVERVIEW:`);
  console.log(`   Total API routes: ${total}`);
  console.log(`   Smoke tested:     ${smokeCount}/${total} (${Math.round(smokeCount / total * 100)}%)`);
  console.log(`   Untested:         ${untestedCount}`);

  const untested = coverage.filter(c => !c.smoke);
  if (untested.length > 0) {
    console.log('\n⚠️  UNTESTED ENDPOINTS:\n');
    const priorities: Priority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    for (const priority of priorities) {
      const items = untested.filter(c => c.priority === priority);
      if (items.length === 0) continue;
      console.log(`   [${priority}]`);
      for (const item of items) {
        console.log(`     ${item.routeKey.padEnd(40)} ${item.endpoint}`);
      }
    }
  }

  console.log('\n📋 FULL COVERAGE MATRIX:\n');
  console.log(`   ${'Route'.padEnd(40)} ${'Smoke'.padEnd(8)} Priority`);
  console.log(`   ${'-'.repeat(40)} ${'-'.repeat(7)} --------`);
  for (const item of coverage) {
    const smoke = item.smoke ? '✅' : '  ';
    console.log(`   ${item.routeKey.padEnd(40)} ${smoke.padEnd(8)} ${item.priority}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n✅ Coverage check complete.`);
  if (untestedCount > 0) {
    console.log(`⚠️  ${untestedCount} endpoints have no test coverage.`);
  }

  // Quality gate: fail hard when high-risk endpoints are untested.
  // classifyPriority() returns CRITICAL for DELETE/DISABLE/PAYMENT/STRIPE routes
  // and HIGH for SESSION/LOGIN/CREATE/UPDATE/SET_ routes. Both warrant a hard stop.
  const blockers = untested.filter(
    c => c.priority === 'CRITICAL' || c.priority === 'HIGH',
  );
  if (blockers.length > 0) {
    const criticalCount = blockers.filter(c => c.priority === 'CRITICAL').length;
    const highCount = blockers.filter(c => c.priority === 'HIGH').length;
    console.error(
      `\n❌ QUALITY GATE FAILED: ${blockers.length} untested endpoint(s) at high risk` +
        ` (CRITICAL: ${criticalCount}, HIGH: ${highCount}).` +
        ` Add smoke tests before merging.`,
    );
    process.exit(1);
  }
}

runCoverageCheck();
