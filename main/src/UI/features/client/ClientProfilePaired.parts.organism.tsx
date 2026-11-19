// UI/features/client/ClientProfilePaired.parts.organism.tsx
// Connected stylists on the client's profile: a list of rows (each opens the
// stylist's gallery) and one action that leads to pairing.

import { useTranslations } from 'next-intl';
import { QrCodeIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { type PairedStylist } from '../../../domain/pairing/pairing.types';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { IllustrationAtom } from '../../components/Illustration/Illustration.atom';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { ClientStylistRowMenuMolecule } from '../shared/pairing/ClientStylistRowMenu.molecule';
import { LP_ASSETS } from '../../assets/lpAssets';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import styles from './ClientProfilePage.module.css';

interface PairedStylistsProps {
  pairs: PairedStylist[];
  /** The pairs query failed with nothing confirmed: the list is UNKNOWN, so
   *  the „no stylist yet, pair now” empty state would be a false claim. */
  loadFailed: boolean;
  onRetry: () => void;
  /** A retry of the failed pairs load is in flight. */
  isRetrying?: boolean;
  /** With no stylist, pairing is the main action of the whole screen. False
   *  while another main action is on screen (the contact form being saved). */
  pairIsMainAction: boolean;
}

export function PairedStylistsStripOrganism({
  pairs,
  loadFailed,
  onRetry,
  isRetrying = false,
  pairIsMainAction,
}: PairedStylistsProps) {
  const t = useTranslations('pages.clientProfile');
  const tPairing = useTranslations('pages.pairing');
  const tLabels = useTranslations('labels');
  const tButtons = useTranslations('buttons');
  const lang = useCurrentLang();

  if (loadFailed) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle} data-app-section-title=''>
          {t('pairedTitle')}
        </h2>
        <ErrorStateMolecule
          message={t('pairedLoadError')}
          retryLabel={tButtons('retry')}
          onRetry={onRetry}
          isRetrying={isRetrying}
        />
      </section>
    );
  }

  if (pairs.length === 0) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle} data-app-section-title=''>
          {t('pairedTitle')}
        </h2>
        <EmptyStateAtom
          illustration={
            <IllustrationAtom src={LP_ASSETS.empty.clientProfile} size='md' />
          }
          description={t('pairedEmpty')}
          lang={lang}
          action={
            <LinkButtonAtom
              href={ROUTES_FRONT.PAIRING}
              variant={pairIsMainAction ? 'primary' : 'outlined'}
              size='md'
              icon={<QrCodeIcon size={18} />}>
              {t('pairedEmptyCta')}
            </LinkButtonAtom>
          }
        />
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle} data-app-section-title=''>
          {t('pairedTitle')}
        </h2>
        <p className={styles.sectionHint}>{t('pairedSubtitle')}</p>
      </header>

      <NavRowListMolecule ariaLabel={t('pairedTitle')}>
        {pairs.map(stylist => {
          // `||`: a stylist onboarded with the role alone has an empty name.
          const name =
            stylist.display_name ||
            stylist.business_name ||
            tLabels('stylistFallback');
          const avatar = <AvatarAtom name={name} size='md' decorative />;
          if (stylist.counterpart_inactive) {
            // A deactivated account has no gallery to open: a static row.
            return (
              <NavRowMolecule
                key={stylist.account_id}
                leading={avatar}
                label={name}
                description={t('pairedInactive')}
              />
            );
          }
          // Her gallery inside the app (the tab bar stays), not the public
          // page in PublicLayout (parity with /app/pairing).
          return (
            <NavRowMolecule
              key={stylist.account_id}
              href={buildRoute(ROUTES_FRONT.STYLIST_GALLERY, {
                id: stylist.account_id,
              })}
              leading={avatar}
              label={name}
              // Where the tap leads, in the words of the same row on her
              // dashboard (a reader rated that one clear and asked what these
              // rows open).
              description={tPairing('stylistRowHint')}
              trailing='disc'
              // „Stylistki, które mają dostęp do Twojego profilu”: the access
              // can be taken back right here (the same „more” menu as on the
              // pairing screen).
              end={
                <ClientStylistRowMenuMolecule
                  pairId={stylist.id}
                  stylistAccountId={stylist.account_id}
                  stylistName={name}
                />
              }
            />
          );
        })}
      </NavRowListMolecule>

      {/* One door to pairing. The former „Zobacz wszystkie” chip and the
          „Połącz się” tile both led to this same screen. */}
      <LinkButtonAtom
        href={ROUTES_FRONT.PAIRING}
        variant='outlined'
        size='md'
        icon={<QrCodeIcon size={18} />}
        className={styles.sectionAction}>
        {t('pairedEmptyCta')}
      </LinkButtonAtom>
    </section>
  );
}
