import type { useTranslations } from 'next-intl';
import type { SupportThreadStatus } from '@kernel/models/support/support.dto';
import { StatusPillAtom } from '../../../components/StatusPill/StatusPill.atom';

/**
 * Status wątku wsparcia w widoku ADMINA — jedna pigułka dla listy i dla
 * szczegółów wątku. Wizualną recepturę (tint 12% / obwódka 30% / pismo 85%)
 * niesie `StatusPillAtom`; tutaj zostaje wyłącznie mapa domenowa.
 *
 * DECISION (nie usuwaj tego komentarza): kolory NIE są tu wyrównane do
 * `getSupportStatusColor` po stronie klientki i to jest celowe, nie dryf.
 * Klientka widzi swój wątek: OPEN znaczy „sprawa żyje" i dostaje zieleń.
 * Admin widzi kolejkę do obsłużenia: OPEN znaczy „czeka na odpowiedź" i musi
 * odróżniać się od RESOLVED, które dopiero tu jest sukcesem. Ta sama nazwa
 * statusu niesie dwie różne informacje, bo są dwie różne role przy ekranie —
 * scalenie map zabrałoby adminowi sygnał pilności. Do S100 różnica siedziała
 * w dwóch bajtowo identycznych blokach `.badge*`, po jednym w każdym pliku
 * admina; recepturę usunięto, mapa została.
 */
export function SupportStatusBadgeMolecule({
  status,
  awaitingReply = false,
  t,
}: {
  status: SupportThreadStatus;
  /**
   * The thread is open and its latest message is the person's: the ONE pill
   * says „Czeka na odpowiedź” instead of „Otwarty” (the queue used to carry
   * two pills per row for that, a status and a „Czeka” tag next to the name).
   */
  awaitingReply?: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <StatusPillAtom
      color={getAdminSupportStatusColor(status)}
      label={
        awaitingReply
          ? t('awaitingReply')
          : getAdminSupportStatusLabel(status, t)
      }
    />
  );
}

function getAdminSupportStatusColor(status: SupportThreadStatus): string {
  switch (status) {
    case 'OPEN':
      return 'var(--color-warning)';
    case 'RESOLVED':
      return 'var(--color-success)';
    default:
      return 'var(--color-text-secondary)';
  }
}

function getAdminSupportStatusLabel(
  status: SupportThreadStatus,
  t: ReturnType<typeof useTranslations>
): string {
  switch (status) {
    case 'OPEN':
      return t('statusOpen');
    case 'RESOLVED':
      return t('statusResolved');
    default:
      return t('statusClosed');
  }
}
