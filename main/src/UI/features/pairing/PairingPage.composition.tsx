// UI/features/pairing/PairingPage.tsx
// Pairing page -- role-gated: Stylist sees QR generation, Client sees scan + paired list.
// Split into parts file to stay under 300 LOC.
// Stack: TQ v5 + CSS Modules + Phosphor Icons.

import { useTranslations } from 'next-intl';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { useAppRole } from '../../layouts/useAppRole';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import {
  UI_SECTION,
  useUiSectionAllowed,
} from '../../shared/hooks/useSessionRole';
import { StylistPairingOrganism } from './StylistPairing.organism';
import { ClientPairingOrganism } from './PairingPage.parts.organism';
import styles from './PairingPage.module.css';

/* ─── Inner page — owns role switch ─── */

function PairingPageInner() {
  const t = useTranslations('pages.pairing');
  useAppBarTitle(t('appBarTitle'));
  // SSOT gate — UI_SECTION.PAIRING_ISSUE_QR allows STYLIST_ROLE + MASTER_ADMIN.
  // Anyone else (client, not-logged) sees the claim/scan view.
  const canIssueQr = useUiSectionAllowed(UI_SECTION.PAIRING_ISSUE_QR);
  // DECISION: the role gate answers "no" also while the role is not yet KNOWN. Without the wait a
  // stylist briefly saw the client's scan screen (and, with a session that never arrived, until a
  // refresh). Same class as the DECISION in layouts/useAppRole.ts: an unknown role is not the
  // client.
  const { isRoleUnknown } = useAppRole();

  if (isRoleUnknown) {
    return (
      <div className={styles.page} aria-hidden='true'>
        <SkeletonAtom variant='text' width={220} height={28} />
        <SkeletonAtom variant='rect' width='100%' height={320} />
      </div>
    );
  }
  if (canIssueQr) {
    return <StylistPairingOrganism />;
  }
  return <ClientPairingOrganism />;
}

/* ─── Shell with AppLayout ─── */

export function PairingPageComposition() {
  const t = useTranslations('pages.pairing');
  return (
    <AppLayoutComposition title={t('appBarTitle')}>
      <PairingPageInner />
    </AppLayoutComposition>
  );
}
