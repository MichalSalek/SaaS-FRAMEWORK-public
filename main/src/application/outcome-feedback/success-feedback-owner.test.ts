// Guard: one owner per success outcome. A screen that confirms a mutation's
// success itself (snackbar or saved flash in onSuccess) must declare
// `successFeedback: 'screen' | 'silent'` on the IO call, or the event pipeline
// toasts the response event on top of it. What the scanner does and does not
// catch: header of src/test-utils/success-feedback-owner.scanner.ts.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  listSourceFiles,
  readSource,
  scanSuccessFeedbackOwners,
} from '../../test-utils/success-feedback-owner.scanner';

const SRC_ROOT = path.resolve(__dirname, '../..');
const FIXTURES = path.resolve(__dirname, '_fixtures/success-feedback-owner');

// Presence floors count MATCH SITES, not files: a rename of pushNewSnackbar or
// of the option would take them to zero and this guard to a silent green.
const MIN_SITES = 20;
const MIN_DECLARED = 18;

const fixtureFiles = (kind: 'must-fail' | 'must-pass'): string[] =>
  fs
    .readdirSync(path.join(FIXTURES, kind))
    .filter(name => name.endsWith('.fixture'))
    .map(name => path.join(FIXTURES, kind, name));

describe('success feedback has one owner', () => {
  it('anchors exist', () => {
    expect(fs.existsSync(path.join(SRC_ROOT, 'application'))).toBe(true);
    expect(fs.existsSync(path.join(SRC_ROOT, 'UI'))).toBe(true);
    expect(fixtureFiles('must-fail').length).toBeGreaterThanOrEqual(4);
    expect(fixtureFiles('must-pass').length).toBeGreaterThanOrEqual(4);
  });

  it('every screen-owned success confirmation is declared on its IO call', () => {
    const files = listSourceFiles(SRC_ROOT);
    const scan = scanSuccessFeedbackOwners(files, readSource, SRC_ROOT);
    expect(scan.findings.map(f => `${f.file}:${f.line} ${f.reason}`)).toEqual(
      []
    );
    expect(scan.sites).toBeGreaterThanOrEqual(MIN_SITES);
    expect(scan.declared).toBeGreaterThanOrEqual(MIN_DECLARED);
  });

  it.each(fixtureFiles('must-fail'))('fails on %s', file => {
    const scan = scanSuccessFeedbackOwners([file], readSource);
    expect(scan.findings.length).toBeGreaterThan(0);
  });

  it.each(fixtureFiles('must-pass'))('passes on %s', file => {
    const scan = scanSuccessFeedbackOwners([file], readSource);
    expect(scan.findings).toEqual([]);
  });

  it('must-pass samples still contain the shapes they prove', () => {
    const declared = scanSuccessFeedbackOwners(
      fixtureFiles('must-pass'),
      readSource
    );
    // declared-per-call (1) + declared-on-endpoint (1; its `setSavedFlash(false)`
    // is a reset, not a confirmation) + one reasoned escape.
    expect(declared.declared).toBe(2);
    expect(declared.escaped).toBe(1);
  });
});
