import { describe, expect, it } from 'vitest';
import type { CaptureResult } from 'posthog-js';
import {
  redactPosthogUrlProperties,
  redactSensitiveUrl,
} from './posthog-url-sanitizer';

describe('PostHog URL sanitizer', () => {
  it('redacts authCode and other sensitive query values', () => {
    expect(
      redactSensitiveUrl(
        'https://nailfolio.app/app?authCode=secret&role=stylist&code=other'
      )
    ).toBe(
      'https://nailfolio.app/app?authCode=[REDACTED]&role=stylist&code=[REDACTED]'
    );
  });

  it('redacts current URL and referrer properties before events are sent', () => {
    const event = {
      event: 'pageview',
      uuid: 'analytics-url-test',
      properties: {
        $current_url: 'https://nailfolio.app/app?authCode=secret',
        $referrer: 'https://mail.example/click?authCode=secret',
      },
    } as CaptureResult;

    expect(redactPosthogUrlProperties(event)?.properties).toMatchObject({
      $current_url: 'https://nailfolio.app/app?authCode=[REDACTED]',
      $referrer: 'https://mail.example/click?authCode=[REDACTED]',
    });
  });
});
