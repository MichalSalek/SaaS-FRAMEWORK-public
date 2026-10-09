import { useLocale, useTranslations } from 'next-intl';
import { AffordanceDiscAtom } from '../../components/AffordanceDisc/AffordanceDisc.atom';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { formatDate } from '../../../application/date/date.utils';
import type { ClientContactForStylistResponse } from './hooks/useClientContactForStylist';
import styles from './ClientCardPage.module.css';

export function ClientProfileHeroOrganism({
  contact,
  visitCount,
  visitCountIsLowerBound,
  lastVisitDate,
}: {
  contact: ClientContactForStylistResponse | undefined;
  visitCount: number;
  /** Only the loaded pages are counted; older visits exist beyond them. */
  visitCountIsLowerBound: boolean;
  lastVisitDate: string | null;
}) {
  const t = useTranslations('clientCard');
  const locale = useLocale();
  // `|| ` (nie `??`) — backend zwraca pusty string dla klientki bez nadanego
  // imienia; `??` przepuściłby '' i tytuł hero byłby niewidoczny.
  const displayName = contact?.client_name || t('anonymousClient');

  // Dwa człony z separatorem generowanym przez AppHero (kanon „człony
  // nierozrywalne"). Wcześniej jeden span: AppHero trzyma człon w `nowrap`,
  // więc cała fraza „4 wizyty · ostatnia 15 sie 2026" nie łamała się wcale
  // i obok avatara ucinała datę (S111). Kropka wisząca na początku drugiej
  // linii jest już ucinana przez AppHero (separator pozycjonowany absolutnie).
  const meta =
    visitCount > 0 ? (
      <>
        <span>
          {visitCountIsLowerBound
            ? t('visitCountMetaMore', { count: visitCount })
            : t('visitCountMeta', { count: visitCount })}
        </span>
        {lastVisitDate ? (
          <span>
            {t('lastVisitMeta', {
              date: formatDate(lastVisitDate, locale),
            })}
          </span>
        ) : null}
      </>
    ) : undefined;

  return (
    <AppHeroOrganism
      title={displayName}
      meta={meta}
      aside={<AvatarAtom name={displayName} size='lg' decorative />}
    />
  );
}

export function ContactSectionOrganism({
  contact,
  isLoading,
  isError,
  onRetry,
  isRetrying = false,
}: {
  contact: ClientContactForStylistResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  isRetrying?: boolean;
}) {
  const t = useTranslations('clientCard');
  const tButtons = useTranslations('buttons');

  return (
    <section className={styles.block}>
      <SectionHeader title={t('contactTitle')} />
      {isError ? (
        <ErrorStateMolecule
          message={t('contactLoadError')}
          retryLabel={tButtons('retry')}
          onRetry={onRetry}
          isRetrying={isRetrying}
        />
      ) : isLoading ? (
        <SkeletonAtom variant='rect' width='100%' height={136} />
      ) : (
        <ul className={styles.contactList}>
          <ContactRow
            label={t('phone')}
            value={contact?.contact_phone ?? null}
            emptyLabel={t('noPhone')}
            scheme='tel'
          />
          <ContactRow
            label={t('email')}
            value={contact?.contact_email ?? null}
            emptyLabel={t('noEmail')}
            scheme='mailto'
          />
        </ul>
      )}
    </section>
  );
}

/* A value the client shared is a link (call, write) and looks like one: white
 * tappable row with the arrow disc. A missing value is one quiet line, with
 * no label above it and no sign of tappability. */
function ContactRow({
  label,
  value,
  emptyLabel,
  scheme,
}: {
  label: string;
  value: string | null;
  emptyLabel: string;
  scheme: 'tel' | 'mailto';
}) {
  if (!value) {
    return (
      <li className={styles.contactItem}>
        <span className={styles.contactRow}>
          <span className={styles.contactEmpty}>{emptyLabel}</span>
        </span>
      </li>
    );
  }
  return (
    <li className={styles.contactItem}>
      <a
        className={`${styles.contactRow} ${styles.contactRowLink}`}
        href={`${scheme}:${value}`}>
        <span className={styles.contactMeta}>
          <span className={styles.contactLabel}>{label}</span>
          <span className={styles.contactValue}>{value}</span>
        </span>
        <AffordanceDiscAtom size='sm' />
      </a>
    </li>
  );
}

/** Section title on paper, with an optional quiet status line under it. The
 *  line is always mounted when `meta` is passed (even as ''), so a status
 *  that comes and goes never moves the content below. */
export function SectionHeader({
  title,
  meta,
}: {
  title: string;
  meta?: string;
}) {
  return (
    <header className={styles.sectionHeader}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {meta !== undefined && <p className={styles.sectionMeta}>{meta}</p>}
    </header>
  );
}
