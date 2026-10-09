import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import styles from './StylistProfilePage.module.css';

interface ProfileStatsProps {
  bookmarkCount: number;
  totalLikes: number;
  galleryCount: number;
  viewCount: number;
}

interface StatEntry {
  key: string;
  value: number;
  label: string;
  // żywy licznik (view_count) — patrz DECISION przy renderze
  live?: boolean;
}

// DECISION (nie usuwaj tego komentarza):
// Progi widoczności statów engagement (owner-głos 2026-07-15, /ui ux profil — handoff F3):
// social proof pokazujemy TYLKO gdy niesie POZYTYWNY sygnał. Niska liczba
// („1 polubienie profilu") to NEGATYWNY dowód dla nowej stylistki, więc poniżej
// progu stat znika. „prace" (portfolio) NIE mają progu social-proof — to kotwica
// portfolio; kiedy w ogóle stoją na ekranie, rozstrzyga DECISION `s126-profil`
// niżej. JSON-LD (interactionStatistic w _jsonld.helpers)
// trzyma WSZYSTKIE liczniki niezależnie od tych progów (gate'uje na >0 dla SEO).
// Progi są tunowalne w JEDNYM miejscu. NIE usuwać gate'u (odsłoni słabe liczby).
const STAT_MIN_TO_SHOW = { bookmarks: 3, likes: 5, views: 20 } as const;

export function StylistProfileStatsMolecule({
  bookmarkCount,
  totalLikes,
  galleryCount,
  viewCount,
}: ProfileStatsProps) {
  const t = useTranslations('stylist.stats');

  // DECISION (nie usuwaj tego komentarza):
  // bookmarkCount i totalLikes to DWA różne liczniki: bookmark_count = ile klientek
  // polubiło samą stylistkę (JSON-LD BookmarkAction), total_likes = ile polubień
  // zebrały jej prace (JSON-LD LikeAction). Po owner-decyzji „ujednolić do Polub”
  // (dd13cab3) obie gołe etykiety brzmiałyby identycznie „polubienia” → mylący dubel
  // na sąsiadujących statach. Owner wybrał wariant B (2026-07-15): zakres w słowniku
  // „polub” — stats.bookmarks=„polubień profilu”, stats.likes=„polubień prac”.
  // NIE scalać w jeden licznik, NIE skracać z powrotem do „polubienia” (odtworzy dubel).
  // DECISION (nie usuwaj tego komentarza) — owner 2026-10-08, zamknięte głosem
  // `s126-profil` (2026-10-09): pusty profil „wygląda jak glitch”, bo stał na
  // nim wąski, wysoki boks „0 prac”. Pusty profil to wizytówka BEZ licznika:
  // „prace” wchodzą do pasa dopiero od pierwszej pracy.
  const stats: StatEntry[] = [];
  if (galleryCount > 0) {
    stats.push({
      key: 'works',
      value: galleryCount,
      label: t('works', { count: galleryCount }),
    });
  }
  if (bookmarkCount >= STAT_MIN_TO_SHOW.bookmarks) {
    stats.push({
      key: 'bookmarks',
      value: bookmarkCount,
      label: t('bookmarks', { count: bookmarkCount }),
    });
  }
  if (totalLikes >= STAT_MIN_TO_SHOW.likes) {
    stats.push({
      key: 'likes',
      value: totalLikes,
      label: t('likes', { count: totalLikes }),
    });
  }
  if (viewCount >= STAT_MIN_TO_SHOW.views) {
    stats.push({
      key: 'views',
      value: viewCount,
      label: t('views', { count: viewCount }),
      live: true,
    });
  }

  // Ciąg dalszy tej samej decyzji: pas stoi dopiero od DWÓCH liczb. Samotna
  // liczba („12 prac”) to ten sam wąski, wysoki boks co „0 prac”, a liczbę
  // prac i tak niesie nagłówek siatki („Wyróżnione prace (N)” oraz „+ jeszcze
  // N w pełnej galerii”), więc nic nie ginie. Dwie i więcej liczb z linią
  // dzielącą czytają się jak pas (owner 2026-09-17).
  if (stats.length < 2) {
    return null;
  }

  return (
    <section className={styles.statsRow} aria-label={t('ariaLabel')}>
      {stats.map((stat, i) => (
        <Fragment key={stat.key}>
          {i > 0 && <div className={styles.statDivider} aria-hidden='true' />}
          <div className={styles.statItem}>
            {/* DECISION (nie usuwaj — dotyczy tylko `live`/view_count):
             * view_count jest ŻYWYM licznikiem inkrementowanym przy KAŻDYM wejściu
             * na profil (incrementProfileView_IO). Renderowany w SSR rozjeżdżał się
             * z pierwszym renderem klienta, gdy licznik zmienił się między fetchem
             * SSR a hydracją → recoverable hydration mismatch na publicznym profilu
             * (kluczowy SEO entry-point). suppressHydrationWarning na wartości i
             * etykiecie „wyświetleń” — React toleruje różnicę żywego licznika BEZ
             * regeneracji drzewa i BEZ layout-shiftu. mounted-gate był gorszy
             * (deterministyczny CLS). NIE usuwać suppressHydrationWarning na `live`. */}
            <TypographyAtom
              variant='subtitle'
              className={styles.statValue}
              suppressHydrationWarning={stat.live}>
              {stat.value}
            </TypographyAtom>
            <TypographyAtom
              variant='caption'
              className={styles.statLabel}
              suppressHydrationWarning={stat.live}>
              {stat.label}
            </TypographyAtom>
          </div>
        </Fragment>
      ))}
    </section>
  );
}
