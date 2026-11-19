import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  trackMarketingVideo,
  watchedPercentage,
} from './marketingVideo.analytics';
import { emitAnalyticsEvent } from '../../../../application/analytics/analytics-sinks';
import { useCookieConsentStore } from '../../../../application/stores/cookieConsent.store';
import type { ResolvedMarketingVideo } from './marketingVideo.config';

vi.mock('../../../../application/analytics/analytics-sinks', () => ({
  emitAnalyticsEvent: vi.fn(),
}));
const media: ResolvedMarketingVideo = {
  videoLanguage: 'en',
  captionLanguage: 'de',
  uiLanguage: 'de',
  asset: {
    id: 'kod-na-blacie',
    version: 'v1',
    approved: true,
    captionsBurnedIn: false,
    durationSeconds: 58,
    src: '/media/kod-na-blacie/en.mp4',
    captions: { de: '/media/kod-na-blacie/de.vtt' },
  },
};
afterEach(() => {
  useCookieConsentStore.setState({ consent: null });
  vi.clearAllMocks();
});

describe('video viewing measurements', () => {
  it('does not emit when analytics were explicitly refused', () => {
    useCookieConsentStore.setState({
      consent: { necessary: true, analytics: false, marketing: false },
    });
    trackMarketingVideo('marketing_video_started', media);
    expect(emitAnalyticsEvent).not.toHaveBeenCalled();
  });
  it('uses the existing sink with separate UI/audio/caption languages and version', () => {
    trackMarketingVideo('marketing_video_progress', media, { percent: 25 });
    expect(emitAnalyticsEvent).toHaveBeenCalledWith(
      'marketing_video_progress',
      {
        video_id: 'kod-na-blacie',
        video_version: 'v1',
        video_language: 'en',
        ui_language: 'de',
        default_caption_language: 'de',
        location: 'home-hero',
        percent: 25,
      }
    );
  });
  it('uses disjoint played ranges, not the furthest position, and rejects unknown duration', () => {
    const ranges: TimeRanges = {
      length: 2,
      start: i => (i === 0 ? 0 : 50),
      end: i => (i === 0 ? 3 : 51),
    };
    expect(watchedPercentage(ranges, 58)).toBeCloseTo(6.8965, 3);
    expect(watchedPercentage(ranges, Number.NaN)).toBe(0);
    expect(watchedPercentage(ranges, 0)).toBe(0);
  });
});
