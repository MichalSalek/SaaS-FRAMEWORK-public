import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { ShareNetworkIcon, CheckIcon } from '@phosphor-icons/react';
import { shareContent } from '../../../application/platform/share';
import { detectPlatform } from '../../../application/platform/platform.detection';
import styles from './ShareButton.module.css';

export interface ShareButtonProps {
  url: string;
  title: string;
  text?: string;
  label?: string;
  fullWidth?: boolean;
  className?: string;
}

export function ShareButtonAtom({
  url,
  title,
  text,
  label,
  fullWidth = false,
  className,
}: ShareButtonProps) {
  const t = useTranslations('share');
  const resolvedLabel = label ?? t('defaultLabel');
  const [feedback, setFeedback] = useState<'copied' | 'failed' | null>(null);
  const copied = feedback === 'copied';

  // Timer gaszący feedback z cleanupem (unmount w trakcie 2s = setState na
  // odmontowanym komponencie) — wzorzec jak w StylistProfilePage.composition.
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
    // Feedback „skopiowano" TYLKO dla realnego clipboard-fallbacku; wcześniej
    // odpalał na `false` = anulowanie/błąd (odwrócona semantyka, review S51).
    if (outcome === 'clipboard') {
      setFeedback('copied');
      return;
    }
    // Brak Web Share i odmowa schowka (np. przeglądarka bez uprawnienia): bez
    // tej gałęzi klik nie robił NIC. `false` daje też anulowanie arkusza
    // (natywnego albo Web Share) — to decyzja użytkowniczki, nie błąd — więc
    // komunikat tylko w przeglądarce bez `navigator.share`, gdzie jedyną
    // ścieżką był schowek.
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
        copied && styles.copied,
        className
      )}
      onClick={() => void handleShare()}>
      {/* Bez aria-label na przycisku: nazwą jest widoczny tekst, a stała
          etykieta przykrywała stan „Skopiowano" przed czytnikiem ekranu.
          aria-live ogłasza zmianę tekstu po kliknięciu. */}
      {copied ? (
        <CheckIcon size={fullWidth ? 18 : 16} aria-hidden='true' />
      ) : (
        <ShareNetworkIcon size={fullWidth ? 18 : 16} aria-hidden='true' />
      )}
      <span aria-live='polite'>{feedbackLabel}</span>
    </button>
  );
}
