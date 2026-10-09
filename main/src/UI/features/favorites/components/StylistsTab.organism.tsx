// UI/features/favorites/components/StylistsTab.organism.tsx
// „Stylistki” tab: liked stylist profiles as a list of person rows. A row
// opens the profile; its one trailing control is the „more” menu, which holds
// „remove from liked” in words (the page asks first). Search and order appear
// once the list is long enough to need them.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import { AvatarAtom } from '../../../components/Avatar/Avatar.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../../components/EmptyState/EmptyState.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../../components/NavRow/NavRow.molecule';
import { PageColumnsMolecule } from '../../../components/PageColumns/PageColumns.molecule';
import { AppMenuAtom } from '../../../primitives/AppMenu.atom';
import { useNativeRouter } from '../../../layouts/useNativeRouter';
import { SegmentedControlMolecule } from '../../../components/SegmentedControl/SegmentedControl.molecule';
import { FavoritesStylistsEmptyOrganism } from '../FavoritesPage.parts.organism';
import { useFetchRemainingPages } from '../../shared/gallery/hooks/useFetchRemainingPages';
import styles from '../FavoritesPage.module.css';

type BookmarkedStylist =
  FAVORITE_DTO_API_V1['GET_BOOKMARKED_STYLISTS']['RESPONSE']['records'][number];

type SortOrder = 'newest' | 'oldest';

/** Below this many liked stylists the whole list fits one screen: search and
 *  order would be two controls with nothing to do. */
const CONTROLS_FROM_COUNT = 6;

/** Pagination of the bookmarked-stylists infinite query. */
interface StylistsPagination {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<unknown>;
}

export function StylistsTabOrganism({
  stylists,
  pagination,
  onRemoveBookmark,
  removingAccountId,
}: {
  stylists: BookmarkedStylist[];
  pagination: StylistsPagination;
  /** Asks the page to confirm; `name` is shown in the question. */
  onRemoveBookmark: (stylistAccountId: string, name: string) => void;
  removingAccountId: string | null;
}) {
  const t = useTranslations('pages.favorites');
  const tLabels = useTranslations('labels');
  const router = useNativeRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');

  const filteredStylists = (() => {
    let result = [...stylists];

    const q = searchQuery.toLowerCase().trim();
    if (q) {
      result = result.filter(s => {
        const name = (s.display_name ?? '').toLowerCase();
        const business = (s.business_name ?? '').toLowerCase();
        const city = (s.address_city ?? '').toLowerCase();
        return name.includes(q) || business.includes(q) || city.includes(q);
      });
    }

    if (sortOrder === 'oldest') {
      result.sort((a, b) => a.bookmarked_at.localeCompare(b.bookmarked_at));
    } else {
      result.sort((a, b) => b.bookmarked_at.localeCompare(a.bookmarked_at));
    }

    return result;
  })();

  // Search and „oldest first" run client-side over LOADED pages, so both need
  // the complete (one client's, bounded) list: otherwise a match on a later
  // page read as „no results" and „oldest" meant „oldest of the first page".
  // A failed page stops the loop; the list's scroll trigger shows the retry.
  const needsFullList = searchQuery.trim() !== '' || sortOrder === 'oldest';
  useFetchRemainingPages(needsFullList, pagination);
  const stillSearching =
    pagination.hasNextPage && !pagination.isFetchNextPageError;

  if (stylists.length === 0) {
    return <FavoritesStylistsEmptyOrganism />;
  }

  // Stays once shown (an active search or order keeps it), so removing the
  // sixth stylist does not take the field away mid-use.
  const showControls =
    stylists.length >= CONTROLS_FROM_COUNT ||
    pagination.hasNextPage ||
    needsFullList;

  const list = (
    <>
      {showControls && (
        <div className={styles.stylistControls}>
          <InputAtom
            type='search'
            aria-label={t('stylistsTabSearchAriaLabel')}
            placeholder={t('stylistsTabSearchPlaceholder')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <SegmentedControlMolecule<SortOrder>
            size='sm'
            shape='pill'
            className={styles.viewSwitch}
            ariaLabel={t('stylistsTabSortLabel')}
            value={sortOrder}
            onChange={setSortOrder}
            options={[
              { value: 'newest', label: t('stylistsTabSortNewest') },
              { value: 'oldest', label: t('stylistsTabSortOldest') },
            ]}
          />
        </div>
      )}

      {filteredStylists.length === 0 ? (
        // Still loading later pages: no verdict yet (the parent's scroll
        // trigger shows progress or the retry).
        stillSearching ? null : (
          <EmptyStateAtom
            role='status'
            description={t('stylistsTabNoResults', { query: searchQuery })}
            action={
              <ButtonAtom
                variant='outlined'
                size='sm'
                onClick={() => setSearchQuery('')}>
                {t('clearSearch')}
              </ButtonAtom>
            }
          />
        )
      ) : (
        <NavRowListMolecule ariaLabel={t('stylistsTab')}>
          {filteredStylists.map(stylist => {
            const name = stylist.display_name ?? tLabels('stylistFallback');
            // One quiet line: salon, city, number of works.
            const meta = [
              stylist.business_name,
              stylist.address_city,
              stylist.gallery_count > 0
                ? t('workCount', { count: stylist.gallery_count })
                : null,
            ]
              .filter((part): part is string => Boolean(part))
              .join(', ');
            // The row opens the profile; the cell's one second control (the
            // `end` slot, beside the link, never inside it) is the „more”
            // menu, the same one the stylist has on her client rows.
            // DECISION (nie usuwaj tego komentarza) — przegląd oczami
            // użytkownika, 2026-10-09: do tego dnia stał tu sam szary
            // piktogram osoby z minusem. Czytelniczka bez kontekstu odczytała
            // go jako „usuń tę osobę” albo „rozłącz” i nie umiała powiedzieć,
            // czy dotknięcie jest ostateczne. Usuwanie polubienia stoi teraz
            // słowami w menu („Usuń z polubionych”), a strona nadal pyta
            // przed usunięciem.
            // The meta is DATA of unknown length (a salon's name), so it goes
            // in `note`, which wraps: as a one-line `description` it was cut
            // and lost its last fact („Studio Velvet Nails, Warszaw…”, S126).
            const profileHref = buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
              identifier: stylist.stylist_account_id,
            });
            return (
              <NavRowMolecule
                key={stylist.id}
                href={profileHref}
                leading={<AvatarAtom name={name} size='md' decorative />}
                label={name}
                {...(meta !== '' ? { note: meta } : {})}
                end={
                  <AppMenuAtom>
                    <AppMenuAtom.MoreTrigger
                      label={t('stylistRowMenu', { name })}
                      disabled={
                        removingAccountId === stylist.stylist_account_id
                      }
                    />
                    <AppMenuAtom.Content align='end'>
                      <AppMenuAtom.Item
                        onClick={() => router.push(profileHref)}>
                        {t('stylistRowOpen')}
                      </AppMenuAtom.Item>
                      <AppMenuAtom.Item
                        tone='danger'
                        onClick={() =>
                          onRemoveBookmark(stylist.stylist_account_id, name)
                        }>
                        {t('stylistRowRemove')}
                      </AppMenuAtom.Item>
                    </AppMenuAtom.Content>
                  </AppMenuAtom>
                }
              />
            );
          })}
        </NavRowListMolecule>
      )}
    </>
  );

  // No aside: on a wide page the list keeps a readable measure instead of
  // stretching a two-line row across the whole screen.
  return <PageColumnsMolecule main={list} />;
}
