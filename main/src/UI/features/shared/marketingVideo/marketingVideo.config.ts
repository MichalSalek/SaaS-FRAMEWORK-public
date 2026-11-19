/** Only owner-approved distribution assets belong in this registry. */
export type VideoLanguage = 'pl' | 'en';
export type CaptionLanguage = VideoLanguage | 'de';
export type MarketingVideoPath = `/media/kod-na-blacie/${string}.mp4`;
export type MarketingCaptionPath = `/media/kod-na-blacie/${string}.vtt`;

export interface MarketingVideoAsset {
  id: 'kod-na-blacie';
  version: string;
  src: MarketingVideoPath;
  durationSeconds: number;
  approved: true;
  /** Website uses native caption tracks; distribution files must not bake spoken subtitles in. */
  captionsBurnedIn: false;
  captions: Partial<Record<CaptionLanguage, MarketingCaptionPath>>;
}

export interface MarketingVideoRegistry {
  pl: MarketingVideoAsset | null;
  en: MarketingVideoAsset | null;
}

// DECISION: drafts and missing narration never become a public explainer. Until an approved
// locale asset is published, HomeHero keeps its existing product illustration and CTA.
export const MARKETING_VIDEOS: MarketingVideoRegistry = {
  pl: null,
  en: null,
};

export interface ResolvedMarketingVideo {
  asset: MarketingVideoAsset;
  videoLanguage: VideoLanguage;
  captionLanguage: CaptionLanguage;
  uiLanguage: CaptionLanguage;
}

export function resolveMarketingVideo(
  locale: string,
  registry: MarketingVideoRegistry = MARKETING_VIDEOS
): ResolvedMarketingVideo | null {
  if (locale !== 'pl' && locale !== 'en' && locale !== 'de') {
    return null;
  }
  const videoLanguage = locale === 'de' ? 'en' : locale;
  const asset = registry[videoLanguage];
  if (
    !asset?.approved ||
    asset.captionsBurnedIn !== false ||
    !asset.src.startsWith('/media/kod-na-blacie/') ||
    !asset.captions[locale] ||
    !Number.isFinite(asset.durationSeconds) ||
    asset.durationSeconds <= 0
  ) {
    return null;
  }
  return { asset, videoLanguage, captionLanguage: locale, uiLanguage: locale };
}
