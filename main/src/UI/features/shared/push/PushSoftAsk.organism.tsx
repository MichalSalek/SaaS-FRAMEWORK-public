// UI/features/shared/push/PushSoftAsk.organism.tsx
// The soft ask for pushes: OUR card at the moment a notification obviously
// helps, the system permission prompt only after a tap on its button.
//
// DECISION: never the system prompt on load. A browser asks once (a refusal
// cannot be asked again from the page) and Android 13+ stops asking after two
// refusals, so the one prompt goes to a moment with a reason: a request just
// sent, a session just shared, a stylist on her client list. The card shows
// only while pushes are OFF on this device and can still be switched on; „Nie
// teraz” hides every soft ask on this device for SNOOZE_DAYS. The device switch
// in account settings (PushOptInOrganism) stays the always-available path.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BellRingingIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { CompletionLineMolecule } from '../../../components/OutcomeFeedback/CompletionLine.molecule';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { usePushOptIn } from '../../../../domain/notifications/push/push.controller';
import {
  isPushSoftAskSnoozed,
  snoozePushSoftAsk,
  type PushSoftAskMoment,
} from '../../../../domain/notifications/push/push-soft-ask';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import styles from './PushSoftAsk.module.css';

export function PushSoftAskOrganism({ moment }: { moment: PushSoftAskMoment }) {
  const t = useTranslations('notifications.softAsk');
  const tPush = useTranslations('notifications.push');
  const { status, busy, failed, readFailed, enable } = usePushOptIn();
  // Read after hydration only: the snooze lives in this device's storage.
  const [snoozed, setSnoozed] = useState<boolean | null>(null);
  useEffect(() => {
    setSnoozed(isPushSoftAskSnoozed(Date.now()));
  }, []);

  // A subscribe that has just succeeded keeps the card for its confirmation.
  const [justEnabled, setJustEnabled] = useState(false);
  const visible =
    snoozed === false && status === 'off' && (!readFailed || justEnabled);
  const shownTracked = useRef(false);
  useEffect(() => {
    if (visible && !shownTracked.current) {
      shownTracked.current = true;
      trackFlowStep('notifications', 'soft_ask_shown', { moment });
    }
  }, [visible, moment]);

  if (justEnabled && status === 'on') {
    return (
      <CompletionLineMolecule
        state='complete'
        message={t('enabled')}
        className={styles.done}
      />
    );
  }
  if (!visible) {
    return null;
  }

  return (
    <section
      className={styles.card}
      aria-labelledby={`push-soft-ask-${moment}`}>
      <span className={styles.icon} aria-hidden='true'>
        <BellRingingIcon size={22} weight='regular' />
      </span>
      <div className={styles.text}>
        <TypographyAtom variant='body1' id={`push-soft-ask-${moment}`}>
          {t(`${moment}.title`)}
        </TypographyAtom>
        <TypographyAtom variant='body2' color='var(--color-text-secondary)'>
          {t(`${moment}.body`)}
        </TypographyAtom>
      </div>
      <div className={styles.actions}>
        <ButtonAtom
          variant='outlined'
          size='sm'
          loading={busy}
          onClick={() => {
            trackFlowStep('notifications', 'soft_ask_accepted', { moment });
            setJustEnabled(true);
            void enable();
          }}>
          {t('enable')}
        </ButtonAtom>
        <ButtonAtom
          variant='text'
          size='sm'
          disabled={busy}
          onClick={() => {
            trackFlowStep('notifications', 'soft_ask_dismissed', { moment });
            snoozePushSoftAsk(Date.now());
            setSnoozed(true);
          }}>
          {t('notNow')}
        </ButtonAtom>
      </div>
      {(failed || readFailed) && (
        <CompletionLineMolecule
          state='error'
          message={tPush(readFailed ? 'readFailed' : 'failed')}
          className={styles.line}
        />
      )}
    </section>
  );
}
