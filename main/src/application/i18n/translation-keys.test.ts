// @vitest-environment node
//
// Every translation key the code asks for exists in pl, en and de.
//
// The scanner (test-utils/translation-keys.scanner.ts) reads the source tree with the TypeScript
// compiler, finds every translator by its TYPE and bound namespace, and looks each resolvable key up
// in the three locale trees (next-intl's AppConfig augmentation stays off; DECISION in
// src/types/i18n.d.ts). Honesty checks: a presence floor on CHECKED call sites; a per-file ratchet of
// call sites it cannot verify (baseline may only go down); must-fail / must-pass / unverifiable
// fixtures, including a fake key that appears only in a comment or a string.
//
// Lowering the baseline after converting sites:
//   UPDATE_TRANSLATION_KEYS_BASELINE=1 npx vitest run src/application/i18n/translation-keys.test.ts

import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  countByFile,
  createProjectProgram,
  createVirtualProgram,
  loadAppMessages,
  scanTranslationKeys,
  type MessageTree,
  type TranslationScan,
} from '../../test-utils/translation-keys.scanner';

const MAIN_ROOT = path.resolve(__dirname, '../../..');
const SRC_ROOT = path.join(MAIN_ROOT, 'src');
const FIXTURES = path.join(__dirname, '__fixtures__', 'translation-keys');
const BASELINE_PATH = path.join(__dirname, 'translation-keys.baseline.json');

/** Measured: 4449 checked call sites. Raise it as coverage grows. */
const CHECKED_SITES_FLOOR = 4200;

type Baseline = Record<
  'unverifiableKey' | 'unverifiableTranslator' | 'untypedSlot',
  Record<string, number>
>;

const includeAppFile = (fileName: string): boolean =>
  fileName.startsWith(`${SRC_ROOT}${path.sep}`) &&
  !fileName.includes(`${path.sep}READONLY-shared-kernel${path.sep}`) &&
  !fileName.includes(`${path.sep}test-utils${path.sep}`) &&
  !/\.test\.tsx?$/.test(fileName);

const describeSite = (site: { file: string; line: number; text: string }) =>
  `${site.file}:${String(site.line)} ${site.text.replace(/\s+/g, ' ')}`;

describe('translation keys (static)', () => {
  let scan: TranslationScan;

  beforeAll(() => {
    const program = createProjectProgram(path.join(MAIN_ROOT, 'tsconfig.json'));
    scan = scanTranslationKeys({
      program,
      messages: loadAppMessages(SRC_ROOT),
      includeFile: includeAppFile,
      relativeTo: SRC_ROOT,
    });
  }, 180_000);

  it('every resolvable key exists as a message in pl, en and de', () => {
    const lines = scan.missing.map(
      entry =>
        `${entry.locale} ${entry.key} (${entry.reason}) at ${describeSite(entry)}`
    );
    expect(lines).toEqual([]);
  });

  it('a translator is only handed to a slot declared for its own namespace', () => {
    const lines = scan.namespaceMismatch.map(
      entry =>
        `${describeSite(entry)}: passes '${entry.passed}' into a slot typed '${entry.declared}'`
    );
    expect(lines).toEqual([]);
  });

  it('keeps checking at least the floor of call sites', () => {
    expect(scan.checked.length).toBeGreaterThanOrEqual(CHECKED_SITES_FLOOR);
  });

  it('unverifiable call sites only go down (ratchet)', () => {
    const current: Baseline = {
      unverifiableKey: countByFile(scan.unverifiableKey),
      unverifiableTranslator: countByFile(scan.unverifiableTranslator),
      untypedSlot: countByFile(scan.untypedSlot),
    };
    if (process.env.UPDATE_TRANSLATION_KEYS_BASELINE === '1') {
      fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
    }
    const baseline = JSON.parse(
      fs.readFileSync(BASELINE_PATH, 'utf8')
    ) as Baseline;

    const problems: string[] = [];
    for (const category of Object.keys(current) as (keyof Baseline)[]) {
      const files = new Set([
        ...Object.keys(current[category]),
        ...Object.keys(baseline[category]),
      ]);
      for (const file of files) {
        const now = current[category][file] ?? 0;
        const allowed = baseline[category][file] ?? 0;
        if (now > allowed) {
          const sites = (
            category === 'untypedSlot'
              ? scan.untypedSlot
              : category === 'unverifiableKey'
                ? scan.unverifiableKey
                : scan.unverifiableTranslator
          )
            .filter(site => site.file === file)
            .map(describeSite);
          problems.push(
            `${category} ${file}: ${String(now)} > baseline ${String(allowed)}. ` +
              'Type the key as a literal union or the translator as ' +
              "ReturnType<typeof useTranslations<'ns'>>.\n  " +
              sites.join('\n  ')
          );
        } else if (now < allowed) {
          problems.push(
            `${category} ${file}: ${String(now)} < baseline ${String(allowed)}. ` +
              'Lock the improvement in: UPDATE_TRANSLATION_KEYS_BASELINE=1 npx vitest run ' +
              'src/application/i18n/translation-keys.test.ts'
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('every file named in the baseline exists', () => {
    const baseline = JSON.parse(
      fs.readFileSync(BASELINE_PATH, 'utf8')
    ) as Baseline;
    const missingFiles = Object.values(baseline)
      .flatMap(byFile => Object.keys(byFile))
      .filter(file => !fs.existsSync(path.join(SRC_ROOT, file)));
    expect(missingFiles).toEqual([]);
  });
});

describe('translation-key scanner fixtures', () => {
  const messages = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, 'messages.json'), 'utf8')
  ) as Record<string, MessageTree>;

  const scanFixtures = (dir: string) => {
    const root = path.join(FIXTURES, dir);
    const names = fs
      .readdirSync(root)
      .filter(name => name.endsWith('.tsx.txt'));
    expect(names.length).toBeGreaterThan(0);
    const files = Object.fromEntries(
      names.map(name => [
        path.join(root, name.replace(/\.txt$/, '')),
        fs.readFileSync(path.join(root, name), 'utf8'),
      ])
    );
    const program = createVirtualProgram(files);
    return names.map(name => {
      const fileName = path.join(root, name.replace(/\.txt$/, ''));
      return {
        name,
        scan: scanTranslationKeys({
          program,
          messages,
          includeFile: candidate => candidate === fileName,
          relativeTo: root,
        }),
      };
    });
  };

  it('must-fail samples are caught', () => {
    const silent = scanFixtures('must-fail')
      .filter(
        ({ scan }) =>
          scan.missing.length === 0 && scan.namespaceMismatch.length === 0
      )
      .map(({ name }) => name);
    expect(silent).toEqual([]);
  });

  it('must-pass samples are clean and checked', () => {
    for (const { name, scan } of scanFixtures('must-pass')) {
      expect({
        name,
        missing: scan.missing,
        mismatch: scan.namespaceMismatch,
      }).toEqual({ name, missing: [], mismatch: [] });
      expect(scan.checked.length, name).toBeGreaterThan(0);
      expect(
        scan.unverifiableKey.length +
          scan.unverifiableTranslator.length +
          scan.untypedSlot.length,
        name
      ).toBe(0);
    }
  });

  it('unverifiable samples are counted for the ratchet', () => {
    for (const { name, scan } of scanFixtures('unverifiable')) {
      expect(
        scan.unverifiableKey.length +
          scan.unverifiableTranslator.length +
          scan.untypedSlot.length,
        name
      ).toBeGreaterThan(0);
      expect(scan.missing, name).toEqual([]);
    }
  });
});
