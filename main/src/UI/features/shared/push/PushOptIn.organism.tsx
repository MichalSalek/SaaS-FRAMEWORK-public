// UI/features/shared/push/PushOptIn.organism.tsx
// „Powiadomienia na tym urządzeniu”: the device-level switch for pushes,
// shown in the account's notification settings and, while it is off, at the
// top of the notification centre. The ONLY place that asks the browser or
// the system for the notification permission (never on load).
//
// Shared (features/shared) because two screens render the same control from
// one state hook (domain/notifications/push/push.controller.ts).

import { useTranslations } from 'next-intl';
import { CompletionLineMolecule } from '../../../components/OutcomeFeedback/CompletionLine.molecule';
import { ToggleAtom } from '../../../components/Toggle/Toggle.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { usePushOptIn } from '../../../../domain/notifications/push/push.controller';
import styles from './PushOptIn.module.css';

export function PushOptInOrganism({
  /** The notification centre shows the row only while it can still be switched on. */
  onlyWhenOff = false,
}: {
  onlyWhenOff?: boolean;
}) {
  const t = useTranslations('notifications.push');
  const { status, busy, failed, readFailed, enable, disable } = usePushOptIn();

  if (status === 'unsupported' && !readFailed) {
    return null;
  }
  if (status === 'unknown' || status === 'unsupported') {
    if (onlyWhenOff) {
      return null;
    }
    return (
      <div className={styles.row} aria-busy={busy}>
        <TypographyAtom variant='body2'>{t('label')}</TypographyAtom>
        {readFailed && (
          <CompletionLineMolecule
            state='error'
            message={t('readFailed')}
            className={styles.line}
          />
        )}
      </div>
    );
  }
  if (onlyWhenOff && (status === 'on' || readFailed)) {
    return null;
  }

  const caption =
    status === 'denied'
      ? t('captionDenied')
      : status === 'on'
        ? t('captionOn')
        : t('captionOff');

  return (
    <div className={styles.row} data-status={status}>
      <div className={styles.text}>
        <TypographyAtom variant='body2'>{t('label')}</TypographyAtom>
        <TypographyAtom variant='caption' color='var(--color-text-secondary)'>
          {caption}
        </TypographyAtom>
      </div>
      <ToggleAtom
        checked={status === 'on'}
        onChange={() => {
          void (status === 'on' ? disable() : enable());
        }}
        disabled={busy || readFailed || status === 'denied'}
        aria-label={t('label')}
      />
      {(failed || readFailed) && (
        <CompletionLineMolecule
          state='error'
          message={t(readFailed ? 'readFailed' : 'failed')}
          className={styles.line}
        />
      )}
    </div>
  );
}
