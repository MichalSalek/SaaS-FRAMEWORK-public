// UI/features/account/components/PinnedManager.organism.tsx
// Menedżer przypiętych prac — jedno miejsce, w którym stylistka decyduje, CO
// widzi klientka na publicznym profilu.
//
// DECISION (nie usuwaj tego komentarza) — zgłoszenie ownera 2026-09-09:
// Do tej pory przypinać dało się WYŁĄCZNIE wchodząc w szczegóły pojedynczego
// zdjęcia (/app/photo/[id]), więc funkcja sprzedawana w cenniku („3 → 10 → 15
// → 30 → 50 przypiętych") nie miała w produkcie żadnej widocznej powierzchni:
// „nie wiem w ogóle nic o tym, jak zrobić swój publiczny profil". Ten widok
// pokazuje całą galerię naraz, stan przypięcia na kaflu i licznik limitu.
// Limit i licznik czytamy z usage-stats (SSOT planu), nie z długości listy —
// lista jest stronicowana i pokazywałaby „przypięte 2", gdy naprawdę jest 12.

import { useTranslations } from 'next-intl';
import { PushPinIcon, ImagesIcon } from '@phosphor-icons/react';
import { getCloudinaryThumbUrl } from '../../../../application/cloudinary/cloudinary-url.utils';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../../components/Button/LinkButton.atom';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { EmptyStateAtom } from '../../../components/EmptyState/EmptyState.atom';
import {
  flattenGalleryPages,
  useOwnGallery,
} from '../../shared/gallery/hooks/useOwnGallery';
import { useTogglePin } from '../../shared/gallery/hooks/useTogglePin';
import { useUsageStats } from '../../shared/account/hooks/useUsageStats';
import { isUnlimitedLimit } from '@kernel/policies/pricing.policy';
import { TrialOfferCardOrganism } from '../../shared/upsell/TrialOfferCard.organism';
import styles from './PinnedManager.module.css';

interface PinTileProps {
  galleryRecordId: string;
  assetUrl: string;
  isPinned: boolean;
  /** Limit planu wyczerpany — odpinać wolno zawsze, przypinać już nie. */
  pinDisabled: boolean;
  pinLabel: string;
  unpinLabel: string;
}

function PinTile({
  galleryRecordId,
  assetUrl,
  isPinned,
  pinDisabled,
  pinLabel,
  unpinLabel,
}: PinTileProps) {
  const togglePin = useTogglePin(galleryRecordId);
  const disabled = togglePin.isPending || (!isPinned && pinDisabled);

  return (
    <li>
      {/* Cały kafel przełącza przypięcie. Wcześniej robił to 36px przycisk w
          rogu — poniżej podłogi 44px, a po zwężeniu kolumn do trzech byłby
          jeszcze ciaśniejszy. Pinezka została wskaźnikiem stanu. */}
      <button
        type='button'
        className={`${styles.tile} haptic-press`}
        aria-pressed={isPinned}
        aria-label={isPinned ? unpinLabel : pinLabel}
        disabled={disabled}
        onClick={() => togglePin.mutate(isPinned)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- gallery images are user-uploaded to external CDN */}
        <img
          className={styles.thumb}
          src={getCloudinaryThumbUrl(assetUrl, 400)}
          alt=''
          loading='lazy'
        />
        {/* Stan niesie WAGA glifu (fill = przypięte), nie inny glif: przekreślona
            pinezka na kaflu NIEprzypiętym mówiła „odepnij" dokładnie tam, gdzie
            kliknięcie przypina. */}
        <span className={styles.pinBadge} aria-hidden='true'>
          <PushPinIcon size={16} weight={isPinned ? 'fill' : 'regular'} />
        </span>
      </button>
    </li>
  );
}

export function PinnedManagerOrganism() {
  const t = useTranslations('account.pinned');
  const tButtons = useTranslations('buttons');
  const {
    data,
    isLoading,
    isError,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useOwnGallery();
  const { data: usage } = useUsageStats();

  const records = flattenGalleryPages(data);
  const pinnedCount = usage?.pinned_records ?? 0;
  const maxPinned = usage?.limits.max_pinned_records ?? 0;
  const unlimited = isUnlimitedLimit(maxPinned);
  // DECISION (nie usuwaj tego komentarza) — „NIE WIEM JESZCZE" TO NIE „LIMIT ZERO":
  // sufit pinow jest zwykla liczba, a nie sentinelem (bez limitu = -1), wiec `?? 0`
  // z nierozwiazanej kwerendy daje PRAWDZIWA wartosc „zero" i `0 >= 0` wylaczalo
  // KAZDY kafel oraz wyswietlalo baner „limit 0". Siatka regularnie maluje sie przed
  // zuzyciem (staleTime galerii 30 s, zuzycia 60 s), wiec byl to stan codzienny,
  // nie skrajny. Dopoki limitu nie znamy, nie blokujemy niczego — bramka zapisu
  // po stronie serwera (canPinGalleryRecord) i tak jest ostatnim slowem.
  const limitKnown = usage != null;
  const pinDisabled = limitKnown && !unlimited && pinnedCount >= maxPinned;

  return (
    <section className={styles.section} aria-labelledby='pinned-manager-title'>
      {/* DECISION (nie usuwaj tego komentarza) — pomiar S126 + owner 2026-10-08:
          przy 360px licznik „Przypięte 6 z 30” zabierał wiersz, tytuł łamał się
          na dwie linie, a pinezka wisiała między nimi. Licznik to teraz samo
          „6 z 30” (słowo „Przypięte” niesie już tytuł) jako JEDEN nierozrywalny
          kawałek; ikona i tytuł tworzą parę, która się nie łamie, więc w
          ciasnym wierszu pod spód schodzi CAŁY licznik, nigdy pół tytułu.
          Licznik jest zamontowany zawsze (pusty do wczytania zużycia), żeby
          nagłówek nie drgał, gdy liczby dojdą. */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.titleIcon} aria-hidden='true'>
            <PushPinIcon size={20} />
          </span>
          {/* h4 wizualnie, h2 semantycznie: sekcja stoi bezpośrednio pod <h1>
              ekranu, więc bez tego czytnik ekranu widzi skok h1 → h4. */}
          <TypographyAtom
            variant='h4'
            as='h2'
            id='pinned-manager-title'
            className={styles.heading}>
            {t('title')}
          </TypographyAtom>
        </div>
        <span className={styles.counter}>
          {limitKnown &&
            (unlimited
              ? t('counterUnlimited', { pinned: pinnedCount })
              : t('counter', { pinned: pinnedCount, max: maxPinned }))}
        </span>
      </div>

      {/* Jedna linia stanu w stałym miejscu: opis sekcji albo, przy komplecie,
          co zrobić dalej. Wcześniej nota o limicie i karta oferty wskakiwały
          NAD siatkę w chwili przypięcia ostatniej pracy i spychały kafle spod
          palca. */}
      <p className={styles.note} role='status'>
        {pinDisabled ? t('limitNote', { max: maxPinned }) : t('body')}
      </p>

      {isLoading && (
        <ul className={styles.grid}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <li key={i}>
              <SkeletonAtom
                variant='rect'
                width='100%'
                className={styles.tileSkeleton}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Blad ladowania NIE jest pustą galerią: pusty stan mowi „nie masz jeszcze
          prac", czyli obarcza uzytkowniczke wina za awarie systemu i nie daje
          zadnej drogi wyjscia. Kolejnosc galezi jak w HistorySectionOrganism. */}
      {/* Blad pokazujemy TYLKO wtedy, gdy nie ma czego pokazac. TanStack ustawia
          `status: 'error'` ZACHOWUJAC dane, wiec warunek na samym `isError`
          kasowal z ekranu komplet juz wczytanych prac, gdy padla kolejna strona
          albo odswiezenie w tle — czyli awaria „Wczytaj wiecej" zabierala to,
          co uzytkowniczka juz widziala. */}
      {!isLoading && isError && records.length === 0 && (
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      )}

      {!isLoading && !isError && records.length === 0 && (
        <EmptyStateAtom
          icon={<ImagesIcon size={28} weight='duotone' />}
          title={t('emptyTitle')}
          titleAs='h4'
          description={t('emptyBody')}
          action={
            <LinkButtonAtom
              href={ROUTES_FRONT.GALLERY_UPLOAD_ASSET}
              variant='outlined'
              size='md'>
              {t('emptyCta')}
            </LinkButtonAtom>
          }
        />
      )}

      {!isLoading && records.length > 0 && (
        <>
          <ul className={styles.grid}>
            {records.map(record => (
              <PinTile
                key={record.gallery_record_id}
                galleryRecordId={record.gallery_record_id}
                assetUrl={record.asset_url}
                isPinned={record.is_pinned}
                pinDisabled={pinDisabled}
                pinLabel={t('pin')}
                unpinLabel={t('unpin')}
              />
            ))}
          </ul>
          {hasNextPage && (
            <ButtonAtom
              variant='outlined'
              size='md'
              loading={isFetchingNextPage}
              onClick={() => void fetchNextPage()}>
              {t('loadMore')}
            </ButtonAtom>
          )}
          {/* Limit pinów bez wyjścia był ślepą uliczką; karta renderuje się
              tylko na Free (płatny plan u sufitu nie dostaje oferty). Stoi POD
              siatką: na Free galeria ma najwyżej dwa rzędy, więc karta jest w
              zasięgu wzroku, a jej pojawienie się nie przesuwa kafli. */}
          {pinDisabled && <TrialOfferCardOrganism trigger='pin_limit' nested />}
        </>
      )}
    </section>
  );
}
