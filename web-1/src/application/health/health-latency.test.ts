import { describe, expect, it } from 'vitest';
import { HEALTH_LATENCY_BUDGETS } from '@kernel/domain/admin/health.config';
import { statusFromLatency } from './health-check.utils';

describe('statusFromLatency', () => {
  it('treats a probe under the healthy ceiling as healthy', () => {
    expect(statusFromLatency(50, 'primaryDb')).toBe('healthy');
    expect(statusFromLatency(268, 'logDb')).toBe('healthy');
    expect(statusFromLatency(377, 'externalHttp')).toBe('healthy');
  });

  it('stays degraded past the degraded ceiling (down is an error, not slowness)', () => {
    for (const latencyClass of [
      'primaryDb',
      'logDb',
      'externalHttp',
    ] as const) {
      const { healthyMs, degradedMs } = HEALTH_LATENCY_BUDGETS[latencyClass];
      expect(statusFromLatency(healthyMs, latencyClass)).toBe('degraded');
      expect(statusFromLatency(degradedMs, latencyClass)).toBe('degraded');
      expect(statusFromLatency(degradedMs + 10_000, latencyClass)).toBe(
        'degraded'
      );
    }
  });
});
