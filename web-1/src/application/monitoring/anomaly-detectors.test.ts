/**
 * Unit tests for anomaly-detectors.ts (BDX W4.3).
 *
 * Pure decision logic extracted from anomaly-alerts.operation.ts — zero I/O,
 * no mock plumbing. Covers each detector's trigger/skip boundaries, the
 * no-history guards, grouping, and off-hours window.
 */

import { describe, it, expect } from 'vitest';
import {
  detectPairingAnomaly,
  detectUploadErrorRate,
  detectImpersonationVolume,
  detectImpersonationOffHours,
  isOffHoursUtc,
  PAIRING_SPIKE_MULTIPLIER,
  PAIRING_DROP_MULTIPLIER,
  UPLOAD_ERROR_RATE_THRESHOLD,
  UPLOAD_MIN_VOLUME,
  IMPERSONATION_VOLUME_THRESHOLD,
} from './anomaly-detectors';

// ── detectPairingAnomaly ─────────────────────────────────────────────────────────

describe('detectPairingAnomaly', () => {
  it('no history (avg 0, today 0) → not triggered', () => {
    expect(detectPairingAnomaly(0, 0)).toEqual({ triggered: false });
  });

  it('today > 0 but no baseline (weekCount 0) → not triggered (no spike without baseline)', () => {
    // avgPerDay === 0, todayCount > 0 → the `avgPerDay > 0` guards make this neither
    expect(detectPairingAnomaly(50, 0)).toEqual({ triggered: false });
  });

  it('normal volume within band → not triggered', () => {
    // weekCount 60 → avg 10/day; today 10 is exactly avg, no anomaly
    expect(detectPairingAnomaly(10, 60)).toEqual({ triggered: false });
  });

  it('exactly at spike multiplier → not triggered (strict >)', () => {
    // avg 10/day, threshold = 3x = 30; today 30 is NOT > 30
    expect(detectPairingAnomaly(30, 60)).toEqual({ triggered: false });
  });

  it('above spike multiplier → SPIKE', () => {
    // avg 10/day, today 31 > 30
    const result = detectPairingAnomaly(31, 60);
    expect(result.triggered).toBe(true);
    if (result.triggered) {
      expect(result.anomalyType).toBe('SPIKE');
      expect(result.todayCount).toBe(31);
      expect(result.avgPerDay).toBe(10);
      expect(result.ratio).toBe('3.10');
    }
  });

  it('exactly at drop multiplier → not triggered (strict <)', () => {
    // avg 10/day, drop threshold = 0.3x = 3; today 3 is NOT < 3
    expect(detectPairingAnomaly(3, 60)).toEqual({ triggered: false });
  });

  it('below drop multiplier → DROP', () => {
    // avg 10/day, today 2 < 3
    const result = detectPairingAnomaly(2, 60);
    expect(result.triggered).toBe(true);
    if (result.triggered) {
      expect(result.anomalyType).toBe('DROP');
      expect(result.todayCount).toBe(2);
      expect(result.avgPerDay).toBe(10);
      expect(result.ratio).toBe('0.20');
    }
  });

  it('zero today with positive history → DROP (full collapse)', () => {
    const result = detectPairingAnomaly(0, 60);
    expect(result.triggered).toBe(true);
    if (result.triggered) {
      expect(result.anomalyType).toBe('DROP');
      expect(result.ratio).toBe('0.00');
    }
  });

  it('thresholds are the documented constants', () => {
    expect(PAIRING_SPIKE_MULTIPLIER).toBe(3);
    expect(PAIRING_DROP_MULTIPLIER).toBe(0.3);
  });
});

// ── detectUploadErrorRate ────────────────────────────────────────────────────────

describe('detectUploadErrorRate', () => {
  it('below min volume → not triggered (avoids small-sample false positives)', () => {
    // total 9 < 10 even with 100% errors
    expect(detectUploadErrorRate(0, 9)).toEqual({ triggered: false });
  });

  it('at min volume but rate at threshold → not triggered (strict >)', () => {
    // total 20, 1 error = 5% === threshold, not above
    expect(detectUploadErrorRate(19, 1)).toEqual({ triggered: false });
  });

  it('above threshold with sufficient volume → triggered', () => {
    // total 20, 2 errors = 10% > 5%
    const result = detectUploadErrorRate(18, 2);
    expect(result.triggered).toBe(true);
    if (result.triggered) {
      expect(result.errorCount).toBe(2);
      expect(result.successCount).toBe(18);
      expect(result.totalCount).toBe(20);
      expect(result.ratePct).toBe('10.0');
    }
  });

  it('all errors at exactly min volume → triggered', () => {
    const result = detectUploadErrorRate(0, UPLOAD_MIN_VOLUME);
    expect(result.triggered).toBe(true);
    if (result.triggered) {
      expect(result.ratePct).toBe('100.0');
      expect(result.totalCount).toBe(UPLOAD_MIN_VOLUME);
    }
  });

  it('zero errors with high volume → not triggered', () => {
    expect(detectUploadErrorRate(1000, 0)).toEqual({ triggered: false });
  });

  it('threshold constants documented', () => {
    expect(UPLOAD_ERROR_RATE_THRESHOLD).toBe(0.05);
    expect(UPLOAD_MIN_VOLUME).toBe(10);
  });
});

// ── detectImpersonationVolume ────────────────────────────────────────────────────

describe('detectImpersonationVolume', () => {
  it('empty input → not triggered', () => {
    expect(detectImpersonationVolume([])).toEqual({ triggered: false });
  });

  it('below threshold for every admin → not triggered', () => {
    // admin-a: 4 < 5
    const ids = ['a', 'a', 'a', 'a', 'b', 'b'];
    expect(detectImpersonationVolume(ids)).toEqual({ triggered: false });
  });

  it('one admin exactly at threshold → triggered (>=)', () => {
    const ids = ['a', 'a', 'a', 'a', 'a', 'b'];
    const result = detectImpersonationVolume(ids);
    expect(result.triggered).toBe(true);
    if (result.triggered) {
      expect(result.triggeredAdmins).toEqual([{ adminId: 'a', count: 5 }]);
    }
  });

  it('multiple admins over threshold → all reported', () => {
    const ids = [
      'a',
      'a',
      'a',
      'a',
      'a',
      'a', // a: 6
      'b',
      'b',
      'b',
      'b',
      'b', // b: 5
      'c',
      'c', // c: 2 (under)
    ];
    const result = detectImpersonationVolume(ids);
    expect(result.triggered).toBe(true);
    if (result.triggered) {
      const byAdmin = Object.fromEntries(
        result.triggeredAdmins.map(t => [t.adminId, t.count])
      );
      expect(byAdmin).toEqual({ a: 6, b: 5 });
      expect(result.triggeredAdmins).toHaveLength(2);
    }
  });

  it('threshold constant documented', () => {
    expect(IMPERSONATION_VOLUME_THRESHOLD).toBe(5);
  });
});

// ── isOffHoursUtc / detectImpersonationOffHours ──────────────────────────────────

describe('isOffHoursUtc', () => {
  it('off-hours boundaries: 22, 23, 0, 5 are off-hours', () => {
    expect(isOffHoursUtc(22)).toBe(true);
    expect(isOffHoursUtc(23)).toBe(true);
    expect(isOffHoursUtc(0)).toBe(true);
    expect(isOffHoursUtc(5)).toBe(true);
  });

  it('business-hours boundaries: 6 and 21 are NOT off-hours', () => {
    expect(isOffHoursUtc(6)).toBe(false);
    expect(isOffHoursUtc(21)).toBe(false);
    expect(isOffHoursUtc(12)).toBe(false);
  });
});

describe('detectImpersonationOffHours', () => {
  it('during business hours → not triggered even with activity', () => {
    expect(detectImpersonationOffHours(12, ['a', 'b'])).toEqual({
      triggered: false,
    });
  });

  it('off-hours but zero activity → not triggered', () => {
    expect(detectImpersonationOffHours(2, [])).toEqual({ triggered: false });
  });

  it('off-hours with activity → triggered with count + distinct admin ids', () => {
    const result = detectImpersonationOffHours(23, ['a', 'a', 'b']);
    expect(result.triggered).toBe(true);
    if (result.triggered) {
      expect(result.count).toBe(3); // total actions, not distinct
      expect([...result.adminIds].sort()).toEqual(['a', 'b']); // distinct
    }
  });
});
