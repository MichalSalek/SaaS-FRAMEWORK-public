// UI/features/account/components/UsageStatsSection.tsx
// Usage dashboard — key stats for the current user (galleries, pairings, limits).
// Renders inside the „Konto” section of the account settings — STYLIST mode only since the
// 2026-09-09 account-surface work (`resolveAccountSurface`); a dual-role user in
// client mode does not see this section at all.
// Stack: TQ v5 + CSS Modules + Phosphor Icons.

import { ChartBarIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import {
  StatTileBandMolecule,
  StatTileMolecule,
} from '../../../components/StatTile/StatTile.molecule';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { useUsageStats } from '../../shared/account/hooks/useUsageStats';
import { isUnlimitedLimit } from '@kernel/policies/pricing.policy';
import styles from './UsageStatsSection.module.css';

// Wartownik „bez limitu" mieszka w jądrze (`isUnlimitedLimit`, pricing.policy).
// Do S113 był tutaj powtórzony jako literał — razem z sześcioma innymi kopiami
// zapowiedzianymi w tym komentarzu. Jądro eksportuje już predykat, więc kopie znikły.

/* ─── One usage number ─── */

interface UsageTileProps {
  label: string;
  /** Undefined while the stats load: the tile keeps its box, shows no number. */
  value: number | undefined;
  limit?: number | null | undefined;
  /** Said in words under the number when the limit is reached / close. */
  atLimitHint: string;
  nearLimitHint: string;
}

// DECISION (nie usuwaj tego komentarza) — S126:
// The shared StatTile band replaces the local tile (its own icon disc with an
// inset shadow, a tinted frame, and a pink / amber card when a limit was
// close). The limit state is now WORDS under the number („Limit planu”,
// „Blisko limitu”): a tinted card was the only signal and said nothing to a
// screen reader. „value / limit” is one unbreakable piece.
function UsageTile({
  label,
  value,
  limit,
  atLimitHint,
  nearLimitHint,
}: UsageTileProps) {
  // Locale JAWNY (nie `undefined`): Node ICU vs browser ICU różnią się
  // separatorami tysięcy → hydration mismatch (DECISION S18 w AccountPage).
  const lang = useCurrentLang();
  if (value === undefined) {
    return <StatTileMolecule label={label} value='' loading />;
  }
  const unlimited = limit != null && isUnlimitedLimit(limit);
  const capped = limit != null && !unlimited;
  const atLimit = capped && value >= limit;
  const nearLimit = capped && !atLimit && limit > 0 && value / limit >= 0.9;
  const hint = atLimit ? atLimitHint : nearLimit ? nearLimitHint : undefined;
  return (
    <StatTileMolecule
      label={label}
      value={
        <span className={styles.value}>
          {value.toLocaleString(lang)}
          {capped && (
            <span className={styles.limit}>
              {' / '}
              {limit.toLocaleString(lang)}
            </span>
          )}
          {unlimited && <span className={styles.limit}> / &infin;</span>}
        </span>
      }
      {...(hint !== undefined ? { hint } : {})}
    />
  );
}

/* ─── Section ─── */

export function UsageStatsSectionOrganism({
  showFavoriteStylists,
}: {
  /** From resolveAccountSurface. A stylist with no client account has no bookmarks. */
  showFavoriteStylists: boolean;
}) {
  const t = useTranslations('account.usageStats');
  const { data, isError, isFetching, refetch } = useUsageStats();
  const limitHints = {
    atLimitHint: t('atLimit'),
    nearLimitHint: t('nearLimit'),
  };

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <ChartBarIcon size={20} className={styles.headerIcon} aria-hidden />
        <TypographyAtom variant='h4' className={styles.heading}>
          {t('sectionTitle')}
        </TypographyAtom>
      </div>

      {/* A failed FIRST load is an error with a retry, never zeros. A failed
          background refetch keeps the cached numbers. */}
      {isError && data == null ? (
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={t('retry')}
          isRetrying={isFetching}
          onRetry={() => void refetch()}
        />
      ) : (
        /* The band is mounted while loading too: every tile keeps its final
           box and only the number arrives. */
        <StatTileBandMolecule ariaLabel={t('sectionTitle')}>
          {/* DECISION (nie usuwaj tego komentarza) — 2026-09-10: „bez limitu" to
              WYŁĄCZNIE wartownik -1 z PRICING_POLICY, nigdy `<= 0`. Ten ekran jako
              jedyny testował `<= 0`, więc limit równy 0 renderowałby tu ∞, a dwa
              kliknięcia dalej (PinnedManager, ta sama sekcja konta) ten sam 0
              znaczy „przypinanie zablokowane". Jedna wartość nie może na jednym
              ekranie znaczyć „nieskończoność" i „zero". */}
          <UsageTile
            label={t('statGalleries')}
            value={data?.gallery_records}
            limit={data?.limits.max_gallery_records}
            {...limitHints}
          />
          <UsageTile
            label={t('statPairedClients')}
            value={data?.paired_clients}
            limit={data?.limits.max_paired_clients}
            {...limitHints}
          />
          {/* DECISION (nie usuwaj tego komentarza) — S113, 2026-09-10:
              BEZ `limit`. Ten kafel liczy ZAKŁADKI (`favoriteStylist`), a
              `max_paired_stylists` (3) rządzi PAROWANIEM (`ClientStylistPair`,
              egzekwowane w `pair-request.operations.ts`). Ścieżka zapisu mówi to
              wprost: „Bookmark has no limit — neither client-side nor stylist-side"
              (`bookmarked-stylists.operations.ts`). Zestawienie ich obok siebie
              dawało `N / 3` i od trzeciej zakładki TRWAŁY fałszywy alarm
              „osiągnięto limit" dla limitu, którego nikt nigdy nie sprawdza.
              Nie podstawiać tu innego limitu: zakładki są nielimitowane
              z założenia. */}
          {showFavoriteStylists && (
            <UsageTile
              label={t('statFavoriteStylists')}
              value={data?.favorite_stylists}
              {...limitHints}
            />
          )}
          <UsageTile
            label={t('statPinned')}
            value={data?.pinned_records}
            limit={data?.limits.max_pinned_records}
            {...limitHints}
          />
        </StatTileBandMolecule>
      )}
    </section>
  );
}
