import { describe, expect, it } from 'vitest';
import {
  buildBetterStackHeartbeatUrl,
  classifyNeonComputeQuota,
  parseNeonProjectUsage,
} from './neon-compute-quota.monitor';

describe('classifyNeonComputeQuota', () => {
  it('keeps the heartbeat healthy below 85% of the configured budget', () => {
    const result = classifyNeonComputeQuota({
      computeTimeSeconds: 84.99 * 3_600,
      budgetCuHours: 100,
    });

    expect(result.state).toBe('healthy');
    expect(result.usagePercent).toBe(84.99);
  });

  it('fails the heartbeat at 85% to leave recovery margin before suspension', () => {
    const result = classifyNeonComputeQuota({
      computeTimeSeconds: 85 * 3_600,
      budgetCuHours: 100,
      consumptionPeriodEnd: '2026-08-01T00:00:00Z',
    });

    expect(result).toMatchObject({
      state: 'critical',
      usedCuHours: 85,
      budgetCuHours: 100,
      usagePercent: 85,
      consumptionPeriodEnd: '2026-08-01T00:00:00Z',
    });
  });

  it('rejects malformed control-plane responses instead of reporting a false healthy beat', () => {
    expect(() => parseNeonProjectUsage({ project: {} }, 100)).toThrow(
      'invalid compute usage'
    );
  });
});

describe('buildBetterStackHeartbeatUrl', () => {
  it('appends the explicit failure path without exposing the token to logs', () => {
    expect(
      buildBetterStackHeartbeatUrl(
        'https://uptime.betterstack.com/api/v1/heartbeat/secret-token/',
        true
      )
    ).toBe('https://uptime.betterstack.com/api/v1/heartbeat/secret-token/fail');
  });

  it('rejects malformed secret URLs with a fixed sanitized message', () => {
    const secret = 'token-that-must-not-leak';

    expect(() => buildBetterStackHeartbeatUrl(secret, false)).toThrow(
      'Better Stack heartbeat URL is invalid'
    );
    try {
      buildBetterStackHeartbeatUrl(secret, false);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
