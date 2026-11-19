// UI/features/sessions/SessionDetailPage.close.organism.tsx
// The stylist closes a session after the visit: one sentence, the button and
// its confirmation. Last on her session screen, at its own width.
//
// DECISION: the backend accepted the assigned stylist closing from the start
// (`closeSessionContainer_IO`) but the screen had no button. Same action, same name and same look
// as on the client's screen; the confirmation says what closing means for HER: the session leaves
// her list, stays as a visit in the client's history, and the client can no longer change it. After
// closing she returns to the sessions she received (the closed one is no longer there). (owner
// 2026-10-11)

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { useCloseSession } from './hooks/useCloseSession';
import {
  DetailCloseActionMolecule,
  DetailCloseDialogMolecule,
} from './ClientSessionDetailPage.actions.molecule';
import styles from './SessionDetailPage.module.css';

export function StylistCloseSessionOrganism({
  sessionId,
}: {
  sessionId: string;
}) {
  const t = useTranslations('pages.sessions');
  const closeMutation = useCloseSession(ROUTES_FRONT.SHARED, 'stylist');
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <section className={styles.closeBlock}>
      <p className={styles.closeHint}>{t('inboxCloseHint')}</p>
      <DetailCloseActionMolecule
        onCloseSession={() => setConfirmOpen(true)}
        closeIsPending={closeMutation.isPending}
        t={t}
      />
      <DetailCloseDialogMolecule
        open={confirmOpen}
        isPending={closeMutation.isPending}
        onOpenChange={setConfirmOpen}
        onConfirm={() => {
          if (!closeMutation.isPending) {
            closeMutation.mutate(sessionId, {
              onSuccess: () => setConfirmOpen(false),
            });
          }
        }}
        body={t('inboxCloseConfirmBody')}
        t={t}
      />
    </section>
  );
}
