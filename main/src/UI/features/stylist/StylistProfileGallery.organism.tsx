import { useTranslations } from 'next-intl';
import { ImagesIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { useStylistGallery } from '../shared/gallery/hooks/useStylistGallery';
import { GalleryPhotoCardOrganism } from '../../components/GalleryPhotoCard/GalleryPhotoCard.organism';
import type { GalleryRecordView } from '../../components/GalleryPhotoCard/GalleryPhotoCard.organism';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import styles from './StylistProfilePage.module.css';

interface StylistProfileGalleryProps {
  accountId: string;
  /** Nieukryte prace stylistki (publiczny rozmiar portfolio, liczony z bazy) — patrz DECISION niżej. */
  galleryRecordsCount: number;
}

export function StylistProfileGalleryOrganism({
  accountId,
  galleryRecordsCount,
}: StylistProfileGalleryProps) {
  const t = useTranslations('stylist.gallery');
  const tGallery = useTranslations('pages.gallery');
  const tButtons = useTranslations('buttons');
  const {
    allRecords,
    isLoading,
    isError,
    isFetching,
    hasData,
    refetch,
    showWatermark,
  } = useStylistGallery(accountId);
  // Same query key as the page's own read, so this costs no request. Own
  // profile = the viewer's stylist account is the account on screen.
  const { data: viewer } = useCurrentUserAccount();
  const isOwnProfile = viewer?.stylist_account?.account_id === accountId;

  // DECISION (nie usuwaj tego komentarza) — 2026-09-09:
  // Pokazujemy WSZYSTKIE przypięte prace, jakie oddał backend. Wcześniej
  // siatka ścinała je do czterech, a endpoint publiczny do pięciu, więc
  // sprzedawana drabinka pinów (3→10→15→30→50) kończyła się na piątce i plan
  // Studio wyglądał na profilu identycznie jak Free. Sufit liczbowy jest teraz
  // JEDEN i mieszka w planie (publicGetGalleryRecordsByAccount_IO).
  // `is_pinned: false` zostaje CELOWO: na tej stronie przypięte są wszystkie
  // rekordy, więc badge „przypięte" na każdym kaflu byłby szumem, nie sygnałem.
  const previewRecords: GalleryRecordView[] = allRecords.map(r => ({
    ...r,
    is_pinned: false,
  }));

  if (isLoading) {
    // DD3-D4: cztery kafle-zastępniki w tej samej siatce co prace (1 kolumna,
    // 2 kolumny od 480px — StylistProfilePage.module.css) i w proporcji kafla
    // 3:4, żeby dojście rekordów nie przesuwało reszty strony. Cztery = liczba
    // zastępników, NIE sufit galerii: ten mieszka w planie (DECISION niżej).
    return (
      <section className={styles.section} aria-busy='true' aria-live='polite'>
        <SkeletonAtom variant='text' width='55%' height={24} />
        <div className={styles.galleryGrid}>
          {[0, 1, 2, 3].map(i => (
            <SkeletonAtom
              key={i}
              variant='rect'
              width='100%'
              height={0}
              className={styles.skeletonPhoto}
            />
          ))}
        </div>
      </section>
    );
  }

  // Nieudany odczyt ≠ pusta galeria: bez tej gałęzi awaria sieci renderowała
  // „Portfolio jeszcze puste" pod profilem, który ma prace. Nieświeże dane po
  // nieudanym odświeżeniu w tle zostają na ekranie (gałąź tylko bez danych,
  // więc realnie pusta galeria po nieudanym odświeżeniu zostaje pustym stanem).
  if (isError && !hasData) {
    return (
      <section className={styles.section}>
        <ErrorStateMolecule
          message={tGallery('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      </section>
    );
  }

  // Pusty stan po REALNIE załadowanej galerii, nie po liczniku z profilu:
  // przy rozjeździe (cached count > 0, zero rekordów publicznych) nagłówek
  // obiecywał N prac nad pustą siatką.
  //
  // DECISION (nie usuwaj tego komentarza) — owner 2026-10-08, zamknięte głosem
  // `s126-profil` (2026-10-09): pusty profil „wygląda jak glitch”. Odwiedzająca
  // dostaje jedno spokojne zdanie, a WŁAŚCICIELKA profilu (zalogowana, na
  // własnej stronie) zachętę z jedną akcją: dodaniem pierwszej pracy. To
  // jedyny wypełniony przycisk na jej ekranie, bo stylistka nie widzi prośby
  // o połączenie.
  if (!isLoading && allRecords.length === 0) {
    return (
      <section className={styles.section}>
        <EmptyStateAtom
          icon={<ImagesIcon size={28} />}
          title={t('empty')}
          titleAs='h2'
          description={isOwnProfile ? t('ownerEmptyDesc') : t('emptyDesc')}
          {...(isOwnProfile
            ? {
                action: (
                  <LinkButtonAtom
                    href={ROUTES_FRONT.GALLERY_UPLOAD_ASSET}
                    variant='primary'
                    size='md'
                    direction='forward'>
                    {t('ownerEmptyCta')}
                  </LinkButtonAtom>
                ),
              }
            : {})}
        />
      </section>
    );
  }

  // DECISION (nie usuwaj tego komentarza) — 2026-09-09, zaktualizowane
  // 2026-09-10: DWIE liczby, jedna prawda w nagłówku. Mieszanie liczników dawało
  // nagłówek „Wyróżnione prace (10)" nad siatką trzech kafli:
  //   1. `galleryRecordsCount` (prop, z profilu; od s34 liczone z bazy, bez prac
  //      ukrytych przez moderację) = WSZYSTKIE widoczne prace, także nieprzypięte;
  //   2. `previewRecords.length` = rekordy REALNIE wyrenderowane w siatce.
  // Nagłówek mówi „Wyróżnione prace", więc liczy (2) — jedyną liczbę, która z
  // definicji nie może rozjechać się z tym, co widać. „+ jeszcze N w pełnej
  // galerii" to inny fakt (reszta portfolio poza wyróżnionymi) i liczy się z
  // (1) minus (2); Math.max zostaje jako bezpiecznik.
  // Trzeciego kandydata — `total_count` z endpointu publicznego — nie ma tu już
  // z czego wziąć: `useStylistGallery` przestał go zwracać (2026-09-10), bo
  // backend ścina go tym samym sufitem planu co listę, więc równa się długości
  // listy. Uzasadnienie: DECISION w useStylistGallery.
  const featuredCount = previewRecords.length;
  const moreCount = Math.max(0, galleryRecordsCount - featuredCount);

  return (
    <section className={styles.section}>
      <TypographyAtom variant='h2' className={styles.sectionTitle}>
        {/* Licznik danych w serif-nagłówku → sans tabular (global .data-count;
         * Marcellus renderuje „10" jak „1O"). Tag <dataCount> żyje w i18n —
         * bez taga w message t.rich renderuje licznik bez wrappera (graceful). */}
        {t.rich('featuredCount', {
          count: featuredCount,
          dataCount: chunks => <span className='data-count'>{chunks}</span>,
        })}
      </TypographyAtom>
      <div className={styles.galleryGrid}>
        {previewRecords.map(record => (
          <GalleryPhotoCardOrganism
            key={record.gallery_record_id}
            record={record}
            showHeart={false}
            showWatermark={showWatermark}
            showShare
          />
        ))}
      </div>
      {moreCount > 0 && (
        <TypographyAtom variant='caption' className={styles.galleryMore}>
          {t('moreWorks', { count: moreCount })}
        </TypographyAtom>
      )}
    </section>
  );
}
