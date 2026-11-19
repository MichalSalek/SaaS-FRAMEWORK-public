import { emitAnalyticsEvent } from '../../../../application/analytics/analytics-sinks';
import { useCookieConsentStore } from '../../../../application/stores/cookieConsent.store';
import type { ResolvedMarketingVideo } from './marketingVideo.config';

export type MarketingVideoEvent =
  | 'marketing_video_started'
  | 'marketing_video_progress'
  | 'marketing_video_ended'
  | 'marketing_video_error';

/** Watched ranges, rather than the seek position, measure actual viewing progress. */
export function watchedPercentage(
  played: TimeRanges,
  duration: number
): number {
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  let seconds = 0;
  for (let index = 0; index < played.length; index += 1) {
    seconds += Math.max(
      0,
      Math.min(duration, played.end(index)) - played.start(index)
    );
  }
  return Math.min(100, Math.max(0, (seconds / duration) * 100));
}

export function trackMarketingVideo(
  event: MarketingVideoEvent,
  media: ResolvedMarketingVideo,
  props: {
    percent?: number;
    watched_percent?: number;
    error_code?: number;
  } = {}
): void {
  if (useCookieConsentStore.getState().consent?.analytics === false) {
    return;
  }
  // The common sink also excludes nf_internal traffic and honours the existing consent model.
  emitAnalyticsEvent(event, {
    video_id: media.asset.id,
    video_version: media.asset.version,
    video_language: media.videoLanguage,
    ui_language: media.uiLanguage,
    default_caption_language: media.captionLanguage,
    location: 'home-hero',
    ...props,
  });
}
