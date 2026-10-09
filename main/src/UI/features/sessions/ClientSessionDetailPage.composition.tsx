// UI/features/sessions/ClientSessionDetailPage.composition.tsx
// Client view of a session — manage inspiration session, share with stylist.
// Route: /app/sessions/[sessionId]
// Stack: TQ v5 + CSS Modules + Phosphor Icons.
//
// The inner component lives in .parts.composition.tsx (300 LOC split).

import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { DetailSkeletonMolecule } from './ClientSessionDetailPage.blocks.molecule';
import { ClientSessionDetailPageInnerComposition } from './ClientSessionDetailPage.parts.composition';

/* ─── Shell with AppLayout ─── */

export function ClientSessionDetailPageComposition() {
  const t = useTranslations('pages.sessions');
  const router = useRouter();
  // Router query is string | string[] | undefined; on first render (before
  // hydration) sessionId is undefined. Gating on a real id avoids passing ''
  // to the inner component, which would fire a guaranteed-400 detail query.
  const sessionId =
    typeof router.query.sessionId === 'string'
      ? router.query.sessionId
      : undefined;

  return (
    <AppLayoutComposition title={t('sessionTitle')}>
      {sessionId ? (
        <ClientSessionDetailPageInnerComposition sessionId={sessionId} />
      ) : (
        <DetailSkeletonMolecule />
      )}
    </AppLayoutComposition>
  );
}
