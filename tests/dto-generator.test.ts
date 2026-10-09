#!/usr/bin/env npx tsx
/**
 * DTO Generator — Golden Snapshot Test
 *
 * Verifies that the Prisma-to-DTO generator produces byte-for-byte identical
 * output to the committed snapshot. A diff means either:
 *   a) The Prisma schema changed (intentional) → update snapshot
 *   b) The generator regressed (Prisma 6.x syntax break, mrleebo/prisma-ast API
 *      change, config drift) → investigate and fix
 *
 * Run: npm run test:dto-generator
 */

// DECISION (nie usuwaj):
// Golden snapshot test — generator produces deterministic output z Prisma schema.
// Diff = INTENTIONAL update wymaga: 1) verify diff (zamierzone schema change),
// 2) regenerate snapshot, 3) commit oba. NIE auto-update (would defeat purpose).
// Protection: Prisma 6.x breaking syntax → generator silently produces wrong DTOs.

import assert from 'node:assert/strict'
import {execSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// Paths
// ============================================================

const ROOT = path.resolve(import.meta.dirname, '..')
const GENERATED_FILE = path.join(ROOT, '.shared-kernel/models/db_models.generated.dto.ts')
const SNAPSHOT_FILE = path.join(ROOT, 'tests/__snapshots__/db_models.generated.dto.ts.snap')

// ============================================================
// Helpers
// ============================================================

function runGenerator(): void {
  execSync('npm run system:generate-dto', {
    cwd: ROOT,
    stdio: 'pipe', // suppress stdout noise during test run
  })
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8')
}

function writeSnapshot(content: string): void {
  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), {recursive: true})
  fs.writeFileSync(SNAPSHOT_FILE, content, 'utf-8')
}

function formatDiff(snapshot: string, generated: string): string {
  const snapLines = snapshot.split('\n')
  const genLines = generated.split('\n')

  const diffs: string[] = []
  const maxLines = Math.max(snapLines.length, genLines.length)

  for (let i = 0; i < maxLines; i++) {
    const s = snapLines[i]
    const g = genLines[i]
    if (s !== g) {
      diffs.push(`  Line ${i + 1}:`)
      if (s !== undefined) diffs.push(`    - ${JSON.stringify(s)}`)
      if (g !== undefined) diffs.push(`    + ${JSON.stringify(g)}`)
    }
    if (diffs.length > 40) {
      diffs.push('  ... (truncated — too many diffs)')
      break
    }
  }

  return diffs.join('\n')
}

// ============================================================
// Test
// ============================================================

function main(): void {
  console.log('DTO Generator — Golden Snapshot Test')
  console.log('=====================================')

  // Step 1: Run the generator (overwrites the generated file in-place)
  console.log('Running generator (npm run system:generate-dto)...')
  runGenerator()
  console.log('Generator finished.\n')

  // Step 2: Read the freshly generated file
  assert.ok(
    fs.existsSync(GENERATED_FILE),
    `Generated file not found: ${GENERATED_FILE}`,
  )
  const generated = readFile(GENERATED_FILE)

  // Step 3: Check if snapshot exists
  const snapshotExists = fs.existsSync(SNAPSHOT_FILE)

  if (!snapshotExists) {
    // First run — write the snapshot
    writeSnapshot(generated)
    console.log(`Snapshot created: ${path.relative(ROOT, SNAPSHOT_FILE)}`)
    console.log(`Lines: ${generated.split('\n').length}`)
    console.log('\nPASS — snapshot seeded from current generator output.')
    console.log('Commit both the snapshot and this test file.')
    process.exit(0)
  }

  // Step 4: Compare with snapshot
  const snapshot = readFile(SNAPSHOT_FILE)

  if (snapshot === generated) {
    const lineCount = generated.split('\n').length
    console.log(`Snapshot match: ${lineCount} lines`)
    console.log('\nPASS — generator output matches snapshot.')
    process.exit(0)
  }

  // Step 5: Diff detected — FAIL
  const snapLines = snapshot.split('\n').length
  const genLines = generated.split('\n').length

  console.error('FAIL — generator output differs from snapshot!')
  console.error(`  Snapshot: ${snapLines} lines  |  Generated: ${genLines} lines`)
  console.error('\nDiff (snapshot vs generated):')
  console.error(formatDiff(snapshot, generated))
  console.error('\nTo update the snapshot (only if diff is intentional):')
  console.error(`  1. Verify the diff is a deliberate schema change`)
  console.error(`  2. Run: cp ${GENERATED_FILE} ${SNAPSHOT_FILE}`)
  console.error(`  3. Commit both files`)
  process.exit(1)
}

main()
