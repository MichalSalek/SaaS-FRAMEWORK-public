/**
 * Golden-master tests for dunning-email.resolver.ts (BDX W0.2 part B).
 *
 * Covers:
 *  - resolveDunningEmail: full attempt_count→rule table
 *    · exact-match (triggerAttempt: number) — attempt 1
 *    · range-match (triggerAttempt: { min, max? }) — attempts 2-3 and 4+
 *    · boundary conditions: 0 (below any rule), 1/3/4/5 (edge transitions)
 *    · null for unmapped attempts (0, negative)
 *  - isDunningEmailAlreadySent: Set<EVENT_INFO_TYPE> lookup
 *    · returns true when rule's infoEvent is in the set
 *    · returns false when absent
 *    · boundary: empty set
 *
 * Pure resolver — zero I/O, no mock plumbing required.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveDunningEmail,
  isDunningEmailAlreadySent,
} from './dunning-email.resolver';
import { DUNNING_EMAIL_SCHEDULE } from '@kernel/domain/email/email-schedule.config';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';

// Pull the three known rules from the SSOT so tests stay DRY against schedule changes.
const [RULE_D1, RULE_D7, RULE_D14] = DUNNING_EMAIL_SCHEDULE;
if (RULE_D1 === undefined || RULE_D7 === undefined || RULE_D14 === undefined) {
  throw new Error(
    `dunning-email.resolver.test: expected 3 rules in DUNNING_EMAIL_SCHEDULE, got ${DUNNING_EMAIL_SCHEDULE.length}`
  );
}

describe('resolveDunningEmail', () => {
  // ── null cases ────────────────────────────────────────────────────────────────

  it('returns null for attempt_count 0 (below any rule)', () => {
    expect(resolveDunningEmail(0)).toBeNull();
  });

  it('returns null for negative attempt_count', () => {
    expect(resolveDunningEmail(-1)).toBeNull();
    expect(resolveDunningEmail(-99)).toBeNull();
  });

  // ── exact match: attempt 1 → DUNNING_D1_INFO ─────────────────────────────────

  it('maps attempt_count 1 to DUNNING_D1_INFO (exact match)', () => {
    const result = resolveDunningEmail(1);
    expect(result).not.toBeNull();
    expect(result).toBe(RULE_D1);
    expect(result?.id).toBe('DUNNING_D1_INFO');
    expect(result?.infoEvent).toBe('EMAIL_DUNNING_D1_INFO_SENT');
  });

  // ── range match: attempts 2–3 → DUNNING_D7_URGENT (min:2, max:3) ─────────────

  it('maps attempt_count 2 to DUNNING_D7_URGENT (range min boundary)', () => {
    const result = resolveDunningEmail(2);
    expect(result).not.toBeNull();
    expect(result).toBe(RULE_D7);
    expect(result?.id).toBe('DUNNING_D7_URGENT');
  });

  it('maps attempt_count 3 to DUNNING_D7_URGENT (range max boundary)', () => {
    const result = resolveDunningEmail(3);
    expect(result).not.toBeNull();
    expect(result).toBe(RULE_D7);
    expect(result?.id).toBe('DUNNING_D7_URGENT');
  });

  // ── range match: attempts 4+ → DUNNING_D14_FINAL (min:4, no max) ─────────────

  it('maps attempt_count 4 to DUNNING_D14_FINAL (open-range min boundary)', () => {
    const result = resolveDunningEmail(4);
    expect(result).not.toBeNull();
    expect(result).toBe(RULE_D14);
    expect(result?.id).toBe('DUNNING_D14_FINAL');
    expect(result?.infoEvent).toBe('EMAIL_DUNNING_D14_FINAL_SENT');
  });

  it('maps attempt_count 5 to DUNNING_D14_FINAL (open-range, above min)', () => {
    const result = resolveDunningEmail(5);
    expect(result).not.toBeNull();
    expect(result).toBe(RULE_D14);
  });

  it('maps a large attempt_count to DUNNING_D14_FINAL (unbounded max)', () => {
    const result = resolveDunningEmail(100);
    expect(result).toBe(RULE_D14);
  });

  // ── boundary between rules ────────────────────────────────────────────────────

  it('does NOT match attempt_count 1 to the D7 range (min=2)', () => {
    // Ensures strict `>=` on range-lower boundary: attempt 1 stays in D1_INFO.
    const result = resolveDunningEmail(1);
    expect(result?.id).toBe('DUNNING_D1_INFO');
  });

  it('does NOT match attempt_count 4 to the D7 rule (max=3)', () => {
    // Ensures strict `<=` on range-upper boundary: attempt 4 falls through to D14_FINAL.
    const result = resolveDunningEmail(4);
    expect(result?.id).toBe('DUNNING_D14_FINAL');
  });
});

describe('isDunningEmailAlreadySent', () => {
  // ── true cases ────────────────────────────────────────────────────────────────

  it('returns true when the rule infoEvent is in the sent set', () => {
    const sentEvents = new Set<EVENT_INFO_TYPE>(['EMAIL_DUNNING_D1_INFO_SENT']);
    expect(isDunningEmailAlreadySent(sentEvents, RULE_D1)).toBe(true);
  });

  it('returns true for D7 rule when its infoEvent is present', () => {
    const sentEvents = new Set<EVENT_INFO_TYPE>([
      'EMAIL_DUNNING_D7_URGENT_SENT',
    ]);
    expect(isDunningEmailAlreadySent(sentEvents, RULE_D7)).toBe(true);
  });

  it('returns true for D14 rule when its infoEvent is present', () => {
    const sentEvents = new Set<EVENT_INFO_TYPE>([
      'EMAIL_DUNNING_D14_FINAL_SENT',
    ]);
    expect(isDunningEmailAlreadySent(sentEvents, RULE_D14)).toBe(true);
  });

  it('returns true when the set contains multiple events including the target', () => {
    const sentEvents = new Set<EVENT_INFO_TYPE>([
      'EMAIL_DUNNING_D1_INFO_SENT',
      'EMAIL_DUNNING_D7_URGENT_SENT',
    ]);
    expect(isDunningEmailAlreadySent(sentEvents, RULE_D7)).toBe(true);
  });

  // ── false cases ────────────────────────────────────────────────────────────────

  it('returns false when the rule infoEvent is NOT in the sent set', () => {
    const sentEvents = new Set<EVENT_INFO_TYPE>(['EMAIL_DUNNING_D1_INFO_SENT']);
    expect(isDunningEmailAlreadySent(sentEvents, RULE_D7)).toBe(false);
  });

  it('returns false for an empty sent set (boundary: no emails sent yet)', () => {
    const sentEvents = new Set<EVENT_INFO_TYPE>();
    expect(isDunningEmailAlreadySent(sentEvents, RULE_D1)).toBe(false);
    expect(isDunningEmailAlreadySent(sentEvents, RULE_D7)).toBe(false);
    expect(isDunningEmailAlreadySent(sentEvents, RULE_D14)).toBe(false);
  });

  it('returns false when other dunning events present but not the queried one', () => {
    const sentEvents = new Set<EVENT_INFO_TYPE>([
      'EMAIL_DUNNING_D14_FINAL_SENT',
    ]);
    expect(isDunningEmailAlreadySent(sentEvents, RULE_D1)).toBe(false);
    expect(isDunningEmailAlreadySent(sentEvents, RULE_D7)).toBe(false);
  });
});
