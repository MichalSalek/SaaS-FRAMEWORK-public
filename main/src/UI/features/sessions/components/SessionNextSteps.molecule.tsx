// UI/features/sessions/components/SessionNextSteps.molecule.tsx
// What the client does AFTER she shares an inspiration session. The session
// used to end on a confirmation with no next step; the stylist had the photos,
// but the client did not know whether to wait, call or write.
//
// DECISION: a real conversation is the soft start. The message action opens
// the existing thread with a draft written into the shared composer store (no
// free text in the URL), so she can edit it before sending. The phone action is
// shown only when the stylist publishes a number. (owner)

import { useTranslations } from 'next-intl';
import { ChatCircleIcon, PhoneIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import {
  composerDraftKey,
  readComposerDraft,
  writeComposerDraft,
} from '../../shared/messaging/hooks/useComposerDraft';
import styles from './SessionNextSteps.module.css';

export function SessionNextStepsMolecule({
  pairId,
  phone,
}: {
  /** The live conversation with this stylist. */
  pairId: string | undefined;
  /** Public contact phone; null when the stylist did not publish one. */
  phone: string | null;
}) {
  const t = useTranslations('pages.sessions');
  if (pairId === undefined) {
    return null;
  }
  const draftKey = composerDraftKey('messaging', pairId);
  return (
    <section className={styles.section} aria-labelledby='session-next-steps'>
      <div className={styles.copy}>
        <TypographyAtom variant='h3' className={styles.title}>
          <span id='session-next-steps'>{t('afterShareTitle')}</span>
        </TypographyAtom>
        <p className={styles.body}>
          {phone === null
            ? t('afterShareBodyMessageOnly')
            : t('afterShareBody')}
        </p>
      </div>
      <div className={styles.actions}>
        <LinkButtonAtom
          href={buildRoute(ROUTES_FRONT.MESSAGES_THREAD, { pairId })}
          variant='primary'
          size='lg'
          icon={<ChatCircleIcon size={18} />}
          onClick={() => {
            // A suggested message must not replace text she already started.
            if (draftKey !== null && readComposerDraft(draftKey).length === 0) {
              writeComposerDraft(draftKey, t('afterShareDraft'));
            }
          }}>
          {t('afterShareMessage')}
        </LinkButtonAtom>
        {phone !== null && (
          <ButtonAtom
            variant='outlined'
            size='md'
            icon={<PhoneIcon size={18} />}
            onClick={() => {
              window.location.href = `tel:${phone}`;
            }}>
            {t('afterShareCall')}
          </ButtonAtom>
        )}
      </div>
    </section>
  );
}
