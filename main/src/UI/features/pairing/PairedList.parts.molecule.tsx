/* ============================================================
 * PairedList.parts — the client's side of the connection lists:
 *  - PairedStylistsSection — heading + rows that open a stylist's gallery
 *  - LimitModalBody        — „free a slot” list inside the limit dialog
 *
 * DECISION (nie usuwaj tego komentarza) — 2026-09-09: osobnego pustego stanu
 * („EmptyPairedState": medalion + „Jeszcze brak połączonych stylistek" + trzy
 * pigułki-atrapy) tu NIE MA i nie wraca. Mówił dokładnie to samo, co karta
 * skanu 200px wyżej („Naciśnij Skanuj kod i wyceluj w stały kod stylistki…"
 * vs „Zeskanuj jej kod QR…") oraz to samo, co meta hero, a jego pigułki
 * wyglądały jak przyciski, nie będąc ani fokusowalnymi, ani klikalnymi — jedna
 * z nich („Przeglądaj galerię") obiecywała klientce BEZ pary galerię, do
 * której nie ma czego otworzyć. Pusty stan tego ekranu niesie karta skanu
 * (wariant `scanCtaBodyEmpty`) z jedyną akcją ekranu.
 *
 * DECISION (nie usuwaj tego komentarza) — S126: pigułki „2/3 połączone” i
 * „1 wolne” też nie wracają. Nikt nie wiedział, co znaczą („1 wolne” czytało
 * się jak status czegoś), a limit mówi teraz hero jednym zdaniem („Połączone
 * stylistki: 2 z 3”). Wejście do zwalniania miejsca przy komplecie, które
 * niosła pigułka-przycisk, przejął przycisk w karcie skanu.
 *
 * DECISION (nie usuwaj tego komentarza) — głos ownera `s126-wiersze`,
 * 2026-10-09: wiersz stylistki (na liście i w oknie limitu) to NavRowMolecule,
 * jak każdy wiersz produktu. Lokalny wiersz osoby (`.person*`) został usunięty
 * razem ze swoim CSS; nie odtwarzaj tu własnej wagi imienia ani rozmiaru daty.
 * ============================================================ */

import { useLocale, type useTranslations } from 'next-intl';
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
  return (
    <section className={styles.listSection}>
      <h2 className={styles.sectionTitle}>{t('stylistsSectionTitle')}</h2>
      <NavRowListMolecule ariaLabel={t('stylistsSectionTitle')}>
        {pairedStylists.map(stylist => {
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
          const name = stylist.display_name ?? stylist.account_id;
          return (
            // Galeria W APLIKACJI, nie publiczna wizytówka: `/stylist/[id]`
            // renderuje PublicLayout bez dolnej belki, więc zalogowana
            // klientka lądowała na stronie marketingowej z jedynym wyjściem
            // przez hamburger (S122). Cel dotknięcia („Galeria”) niesie
            // nazwa dostępna wiersza; wzrokowo mówi go strzałka.
            <NavRowMolecule
              key={stylist.account_id}
              href={buildRoute(ROUTES_FRONT.STYLIST_GALLERY, {
                id: stylist.account_id,
              })}
              leading={<AvatarAtom name={name} size='md' decorative />}
              label={name}
              description={pairedAtLabel}
              ariaLabel={`${name}, ${pairedAtLabel}, ${t('pairedRowAction')}`}
              // One second control beside the row: the „more” menu (gallery,
              // message, disconnect). Until 2026-10-09 the row ended with the
              // arrow disc and a client could disconnect only in the limit
              // dialog (DECISION in ClientStylistRowMenu.molecule).
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
  /** Blokuje przyciski rozłączenia gdy mutacja unpair jest w locie —
   *  revoke jest idempotentny, ale double-click = dwa POSTy i dwa toasty. */
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
              : (stylist.display_name ?? stylist.account_id);
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
