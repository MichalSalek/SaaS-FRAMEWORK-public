import { useTranslations } from 'next-intl';
import { usePairedList } from '../shared/pairing/hooks/usePairedList';
/* ============================================================
 * PairedList.parts — the client's side of the connection lists:
 *  - PairedStylistsSection — heading + rows that open a stylist's gallery
 *  - LimitModalBody        — „free a slot” list inside the limit dialog
 *
 * DECISION: no separate empty state here, and none returns ("EmptyPairedState" with mock
 * pills). It repeated the scan card and the hero meta, and its pills looked like buttons
 * while being neither focusable nor clickable. The empty state is the scan card (variant
 * `scanCtaBodyEmpty`) with the screen's only action; the limit is said by the hero in one
 * sentence ("Połączone stylistki: 2 z 3"), and freeing a slot when full is the button in
 * the scan card. The stylist row (list and limit dialog) is NavRowMolecule like every
 * product row (owner), so do not add a local person row with its own name weight. */

import { useLocale } from 'next-intl';
import { LinkBreakIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { PLATFORM_LIMITS } from '@kernel/policies/pricing.policy';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { formatDate } from '../../../application/date/date.utils';
import { type PairedStylist } from '../../../domain/pairing/pairing.types';
import { ClientFreeSlotDialogMolecule } from './ClientFreeSlotDialog.molecule';
import { ClientStylistRowMenuMolecule } from '../shared/pairing/ClientStylistRowMenu.molecule';
import styles from './PairingPage.module.css';

type PairingPageT = ReturnType<typeof useTranslations<'pages.pairing'>>;

/* ─────────────────────────────────────────────
   PairedStylistsSection — heading + rows
   ───────────────────────────────────────────── */
export function PairedStylistsSectionMolecule({
  pairedStylists,
  t,
}: {
  pairedStylists: PairedStylist[];
  t: PairingPageT;
}) {
  const locale = useLocale();
  const tSalon = useTranslations('salon.profile');
  const tLabels = useTranslations('labels');
  const query = usePairedList();
  const salons = query.data?.pages[0]?.salons ?? [];
  const groupedIds = new Set(
    salons.flatMap(salon => salon.members.map(person => person.account_id))
  );
  return (
    <section className={styles.listSection}>
      <h2 className={styles.sectionTitle}>{t('stylistsSectionTitle')}</h2>
      {salons.length > 0 && (
        <TypographyAtom>{tSalon('directLimitHelp')}</TypographyAtom>
      )}
      {salons.map(salon => (
        <section key={salon.account_id} className={styles.listGroup}>
          {/* A group INSIDE „Twoje stylistki”: below the h2 in level and in
              size (the h3 visual scale is 24px and outranked the 18px h2). */}
          <TypographyAtom variant='subtitle' as='h3'>
            {tSalon('clientSalon', { name: salon.name })}
          </TypographyAtom>
          <NavRowListMolecule>
            {salon.members.map(person => {
              // A member onboarded with the role alone has no name yet.
              const personName = person.name || tLabels('stylistFallback');
              return (
                <NavRowMolecule
                  key={person.account_id}
                  href={`${buildRoute(ROUTES_FRONT.STYLIST_GALLERY, { id: person.account_id })}?galleryScope=salon`}
                  label={personName}
                  description={t('stylistRowHint')}
                  leading={
                    <AvatarAtom
                      name={personName}
                      src={person.avatar_url ?? undefined}
                      decorative
                    />
                  }
                  trailing='disc'
                  end={
                    <ClientStylistRowMenuMolecule
                      pairId={person.pair_id}
                      stylistAccountId={person.account_id}
                      stylistName={personName}
                    />
                  }
                />
              );
            })}
          </NavRowListMolecule>
        </section>
      ))}
      <NavRowListMolecule ariaLabel={t('stylistsSectionTitle')}>
        {pairedStylists
          .filter(stylist => !groupedIds.has(stylist.account_id))
          .map(stylist => {
            const pairedAtLabel = t('pairedAt', {
              date: formatDate(stylist.paired_at, locale),
            });
            if (stylist.counterpart_inactive) {
              const inactiveLabel = t('inactiveAccount');
              // Static row: nothing to open. The sentence and the one action
              // („free the slot”) stand in the note.
              return (
                <NavRowMolecule
                  key={stylist.account_id}
                  leading={
                    <AvatarAtom name={inactiveLabel} size='md' decorative />
                  }
                  label={inactiveLabel}
                  description={pairedAtLabel}
                  note={
                    <>
                      <span>{t('inactiveAccountHint')}</span>
                      <ClientFreeSlotDialogMolecule stylist={stylist} t={t} />
                    </>
                  }
                />
              );
            }
            // `||`, not `??`: a stylist onboarded with the role alone has an
            // empty name, and the account id is never a name to show.
            const name =
              stylist.display_name ||
              stylist.business_name ||
              tLabels('stylistFallback');
            return (
              // The gallery INSIDE the app, not the public profile: `/stylist/[id]`
              // renders PublicLayout without the bottom bar, so a logged-in client
              // landed on a marketing page with only the hamburger as an exit.
              // The row's second line names where the tap leads, in the same words
              // as on the client panel (a blind test showed that with a bare date
              // readers guessed „profile or gallery”).
              <NavRowMolecule
                key={stylist.account_id}
                href={buildRoute(ROUTES_FRONT.STYLIST_GALLERY, {
                  id: stylist.account_id,
                })}
                leading={<AvatarAtom name={name} size='md' decorative />}
                label={name}
                description={t('stylistRowHint')}
                trailing='disc'
                // One second control beside the row: the „more” menu (gallery,
                // message, disconnect), so a client can disconnect outside the
                // limit dialog (DECISION in ClientStylistRowMenu.molecule).
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
    </section>
  );
}

/* ─────────────────────────────────────────────
   LimitModalBody — „free a slot” list (rows + disconnect)
   ───────────────────────────────────────────── */
interface LimitModalBodyProps {
  pairedStylists: PairedStylist[];
  onUnpair: (accountId: string) => void;
  /** Disables the disconnect buttons while an unpair mutation is in flight;
   *  a double click would send two POSTs and show two toasts. */
  isUnpairPending: boolean;
  /** Row whose revoke is in flight — only that button reports aria-busy. */
  unpairingAccountId: string | null;
  t: PairingPageT;
}

export function LimitModalBodyMolecule({
  pairedStylists,
  onUnpair,
  isUnpairPending,
  unpairingAccountId,
  t,
}: LimitModalBodyProps) {
  const locale = useLocale();
  const tLabels = useTranslations('labels');
  return (
    <div className={styles.limitModal}>
      <TypographyAtom variant='body2' className={styles.limitModalDesc}>
        {t('limitModalDesc', {
          max: PLATFORM_LIMITS.MAX_PAIRED_STYLISTS,
        })}
      </TypographyAtom>

      {/* Static rows on the dialog's own surface (the dialog is the box, see
          `.limitList`); the one control of each cell is its disconnect
          button, in the row's `end` slot. */}
      <div className={styles.limitList}>
        <NavRowListMolecule ariaLabel={t('stylistsSectionTitle')}>
          {pairedStylists.map(stylist => {
            const name = stylist.counterpart_inactive
              ? t('inactiveAccount')
              : stylist.display_name ||
                stylist.business_name ||
                tLabels('stylistFallback');
            return (
              <NavRowMolecule
                key={stylist.account_id}
                leading={<AvatarAtom name={name} size='sm' decorative />}
                label={name}
                description={t('pairedAt', {
                  date: formatDate(stylist.paired_at, locale),
                })}
                end={
                  <ButtonAtom
                    variant='outlined'
                    size='sm'
                    icon={<LinkBreakIcon size={16} weight='regular' />}
                    disabled={isUnpairPending}
                    aria-busy={unpairingAccountId === stylist.account_id}
                    onClick={() => onUnpair(stylist.account_id)}>
                    {t('unpairBtn')}
                  </ButtonAtom>
                }
              />
            );
          })}
        </NavRowListMolecule>
      </div>
    </div>
  );
}
