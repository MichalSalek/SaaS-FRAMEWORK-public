// The copy and share actions of a public profile link, shared by the share
// card (dashboard) and the link card at the top of the profile screens.
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { shareContent } from '../../../../application/platform/share';
import { copyText } from '../../../../application/platform/clipboard';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';

// DECISION: the share URL uses window.location.origin, not the brand origin, so copied links stay
// correct on staging, preview and the native WebView. BRAND_CONFIG.url is only the SSR fallback.
// The label drops the scheme; the copied/shared value is always the full URL.
export function resolveProfileUrl(path: string): string {
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : BRAND_CONFIG.url;
  return `${origin}${path}`;
}

export function toDisplayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function useProfileLinkActions(
  path: string,
  target: 'stylist' | 'salon'
) {
  const t = useTranslations('components.profileShare');
  const [copied, setCopied] = useState(false);
  const url = resolveProfileUrl(path);

  // The „Skopiowano” feedback goes out after 2s; cleanup covers an unmount.
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    // copyText goes through the native bridge in the shell and never throws.
    if (await copyText(url)) {
      setCopied(true);
      trackFlowStep('profile', 'shared', { channel: 'copy', target });
    } else {
      pushNewSnackbar(t('copyError'), 'error');
    }
  };

  const share = async () => {
    const channel = await shareContent({
      title: t(target === 'salon' ? 'salonShareTitle' : 'shareTitle'),
      text: t(target === 'salon' ? 'salonShareText' : 'shareText'),
      url,
    });
    if (channel !== false) {
      trackFlowStep('profile', 'shared', { channel, target });
    }
  };

  return { url, displayUrl: toDisplayUrl(url), copied, copy, share };
}
