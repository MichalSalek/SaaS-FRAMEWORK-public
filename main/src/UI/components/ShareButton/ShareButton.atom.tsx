import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { ShareNetworkIcon, CheckIcon } from '@phosphor-icons/react';
import {
  shareContent,
  type ShareOutcome,
} from '../../../application/platform/share';
import { detectPlatform } from '../../../application/platform/platform.detection';
import styles from './ShareButton.module.css';

export interface ShareButtonProps {
  url: string;
  title: string;
  text?: string;
  label?: string;
  fullWidth?: boolean;
  /** A low-priority action in words: no frame, no fill, file under the main
   *  action. The 44px touch target stays. */
  quiet?: boolean;
  /** Called with the channel that actually worked; `false` means cancel/fail. */
  onShared?: (outcome: ShareOutcome) => void;
  className?: string;
}

export function ShareButtonAtom({
  url,
  title,
  text,
  label,
  fullWidth = false,
  quiet = false,
  onShared,
  className,
}: ShareButtonProps) {
  const t = useTranslations('share');
  const resolvedLabel = label ?? t('defaultLabel');
  const [feedback, setFeedback] = useState<'copied' | 'failed' | null>(null);
  const copied = feedback === 'copied';

  // Timer that clears the feedback, with cleanup (an unmount within the 2s would
  // otherwise setState on an unmounted component); same pattern as StylistProfilePage.composition.
  useEffect(() => {
    if (feedback === null) {
      return;
    }
    const timer = window.setTimeout(() => setFeedback(null), 2000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const handleShare = async () => {
    const outcome = await shareContent({
      title,
      url,
      ...(text ? { text } : {}),
    });
    onShared?.(outcome);
    // "Copied" feedback ONLY for a real clipboard fallback; `false` means
    // cancel or failure, never a copy.
    if (outcome === 'clipboard') {
      setFeedback('copied');
      return;
    }
    // No Web Share and the clipboard refused (e.g. no permission): without this
    // branch the click does nothing. `false` also means the user cancelled the
    // share sheet (native or Web Share), which is her choice, not an error, so
    // the message shows only in a browser without `navigator.share`, where the
    // clipboard was the only path.
    if (
      outcome === false &&
      !detectPlatform().isNativeApp &&
      navigator.share == null
    ) {
      setFeedback('failed');
    }
  };

  let feedbackLabel = resolvedLabel;
  if (feedback === 'copied') {
    feedbackLabel = t('copied');
  } else if (feedback === 'failed') {
    feedbackLabel = t('copyFailed');
  }

  return (
    <button
      type='button'
      className={clsx(
        styles.trigger,
        fullWidth && styles.fullWidth,
        quiet && styles.quiet,
        copied && styles.copied,
        className
      )}
      onClick={() => void handleShare()}>
      {/* No aria-label on the button: the visible text is its name; a fixed
          label would hide the „Skopiowano" state from a screen reader.
          aria-live announces the text change after the click. */}
      {copied ? (
        <CheckIcon size={fullWidth ? 18 : 16} aria-hidden='true' />
      ) : (
        <ShareNetworkIcon size={fullWidth ? 18 : 16} aria-hidden='true' />
      )}
      <span aria-live='polite'>{feedbackLabel}</span>
    </button>
  );
}
