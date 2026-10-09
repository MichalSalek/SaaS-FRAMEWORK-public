import { describe, it, expect } from 'vitest';
import {
  isNonActionableClientNoise,
  isNonActionablePosthogException,
  CROSS_ORIGIN_SCRIPT_ERROR_MESSAGE,
  EXTENSION_OBJECT_NOT_FOUND_SIGNATURE,
  POSTHOG_EXCEPTION_EVENT,
  WINDOW_ERROR_NAMESPACE,
  UNHANDLED_REJECTION_NAMESPACE,
} from './error-noise-filter';

// ---------------------------------------------------------------------------
// RED-first guard for the client-error-noise filter.
//
// This is the correct RED-first ratchet for THIS concern: it pins the exact,
// provably-non-actionable prod signatures the predicate must suppress AND pins
// an actionable error it must NOT suppress. Widening the matchers (e.g. dropping
// the empty-filename/stack check on (A), or suppressing on message alone) fails
// RED here. The existing bash `audit:suppress-global-error` guards mutation
// double-toasting — a semantically unrelated concern — so reusing it would
// conflate the two; this Vitest predicate guard is the dedicated ratchet.
// ---------------------------------------------------------------------------

describe('isNonActionableClientNoise — signature constants', () => {
  it('exposes the exact prod signature strings the guard asserts on', () => {
    expect(CROSS_ORIGIN_SCRIPT_ERROR_MESSAGE).toBe('Script error.');
    expect(EXTENSION_OBJECT_NOT_FOUND_SIGNATURE).toBe(
      'Object Not Found Matching Id'
    );
    expect(WINDOW_ERROR_NAMESPACE).toBe('window.error');
    expect(UNHANDLED_REJECTION_NAMESPACE).toBe('unhandledrejection');
  });
});

describe('isNonActionableClientNoise — SUPPRESSES the three prod noise classes', () => {
  it('(A) bare cross-origin "Script error." with no filename and no stack', () => {
    expect(
      isNonActionableClientNoise({
        namespace: WINDOW_ERROR_NAMESPACE,
        message: CROSS_ORIGIN_SCRIPT_ERROR_MESSAGE,
        payload: { filename: '', stack: null },
      })
    ).toBe(true);
  });

  it('(B) extension-injected "Object Not Found Matching Id" rejection', () => {
    expect(
      isNonActionableClientNoise({
        namespace: UNHANDLED_REJECTION_NAMESPACE,
        // Real prod messages ship extra wrapper text around the signature.
        message: `Error: Object Not Found Matching Id:4, MethodName:update`,
        payload: { stack: null },
      })
    ).toBe(true);
  });
});

describe('isNonActionableClientNoise — does NOT suppress actionable errors', () => {
  it('a real same-origin error (own message + filename + stack) stays reported', () => {
    expect(
      isNonActionableClientNoise({
        namespace: WINDOW_ERROR_NAMESPACE,
        message: "Cannot read properties of undefined (reading 'id')",
        payload: {
          filename: 'https://nailfolio.app/_next/static/chunk.js',
          stack: 'TypeError: Cannot read properties of undefined\n  at x',
        },
      })
    ).toBe(false);
  });

  it('a "Script error." that DOES carry a filename is a real error, reported', () => {
    // Over-suppression guard: the mask class requires BOTH filename and stack
    // empty. A same-origin fault whose message happens to be "Script error."
    // but which has a source location must NOT be swallowed.
    expect(
      isNonActionableClientNoise({
        namespace: WINDOW_ERROR_NAMESPACE,
        message: CROSS_ORIGIN_SCRIPT_ERROR_MESSAGE,
        payload: {
          filename: 'https://nailfolio.app/_next/static/chunk.js',
          stack: null,
        },
      })
    ).toBe(false);
  });

  it('a real rejection (own message + stack) stays reported', () => {
    expect(
      isNonActionableClientNoise({
        namespace: UNHANDLED_REJECTION_NAMESPACE,
        message: 'Payment intent confirmation failed',
        payload: { stack: 'Error: ...\n  at confirm' },
      })
    ).toBe(false);
  });

  it('the extension signature under the WRONG namespace is not blindly matched', () => {
    // The (B) branch is scoped to unhandledrejection; a window.error carrying
    // that text would fall through to (A) which it does not match either.
    expect(
      isNonActionableClientNoise({
        namespace: WINDOW_ERROR_NAMESPACE,
        message: 'Object Not Found Matching Id:4',
        payload: {
          filename: 'https://nailfolio.app/_next/static/chunk.js',
          stack: 'Error: ...',
        },
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RED-first guard dla DRUGIEGO sinka (PostHog Error Tracking).
//
// Regresja z produkcji: ten sam maskowany „Script error." był odsiewany z
// AppLogRecord, ale posthog-js łapał go własnymi handlerami → aktywne issue,
// 104 wystąpienia (2026-07-07 → 2026-08-17), zjadające próg alertu. Testy niżej
// pinują, że OBA sinki mają JEDNĄ politykę i że rozszerzenie predykatu na realny
// wyjątek failuje RED.
// ---------------------------------------------------------------------------

describe('isNonActionablePosthogException — parytet progu szumu', () => {
  it('eksponuje nazwę zdarzenia wyjątku, na której filtruje provider', () => {
    expect(POSTHOG_EXCEPTION_EVENT).toBe('$exception');
  });

  it('tłumi maskowany cross-origin „Script error." bez ramek stosu', () => {
    expect(
      isNonActionablePosthogException([
        { type: 'Error', value: CROSS_ORIGIN_SCRIPT_ERROR_MESSAGE },
      ])
    ).toBe(true);
  });

  it('tłumi „Script error." z pustą listą ramek', () => {
    expect(
      isNonActionablePosthogException([
        {
          type: 'Error',
          value: CROSS_ORIGIN_SCRIPT_ERROR_MESSAGE,
          stacktrace: { frames: [] },
        },
      ])
    ).toBe(true);
  });

  it('NIE tłumi „Script error." gdy przeglądarka jednak dała ramkę stosu', () => {
    expect(
      isNonActionablePosthogException([
        {
          type: 'Error',
          value: CROSS_ORIGIN_SCRIPT_ERROR_MESSAGE,
          stacktrace: { frames: [{ filename: 'app.js', lineno: 12 }] },
        },
      ])
    ).toBe(false);
  });

  it('tłumi sygnaturę wstrzykniętą przez rozszerzenie przeglądarki', () => {
    expect(
      isNonActionablePosthogException([
        {
          type: 'Error',
          value: `${EXTENSION_OBJECT_NOT_FOUND_SIGNATURE} 12345`,
        },
      ])
    ).toBe(true);
  });

  it('NIE tłumi realnego wyjątku aplikacji', () => {
    expect(
      isNonActionablePosthogException([
        {
          type: 'TypeError',
          value: "Cannot read properties of undefined (reading 'id')",
          stacktrace: { frames: [{ filename: 'gallery.js', lineno: 88 }] },
        },
      ])
    ).toBe(false);
  });

  it('NIE tłumi łańcucha, w którym choć jeden wpis jest realnym błędem', () => {
    expect(
      isNonActionablePosthogException([
        { type: 'Error', value: CROSS_ORIGIN_SCRIPT_ERROR_MESSAGE },
        { type: 'TypeError', value: 'real failure' },
      ])
    ).toBe(false);
  });

  it('przepuszcza zdarzenie bez listy wyjątków (nie nasza sprawa)', () => {
    expect(isNonActionablePosthogException(undefined)).toBe(false);
    expect(isNonActionablePosthogException([])).toBe(false);
  });
});
