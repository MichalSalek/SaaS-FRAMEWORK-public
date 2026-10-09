import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import {
  BriefcaseIcon,
  CreditCardIcon,
  LifebuoyIcon,
  UserCircleIcon,
  StorefrontIcon,
  type Icon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { DESKTOP_FRAME_MIN_WIDTH } from '../../../application/policies/desktop-access.policy';
import { resolveAccountSurface } from '../../../application/policies/account-surface.policy';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import { buildRoute } from '../../../application/routing/buildRoute';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { GetAppHeroOrganism } from '../static/GetAppHero.organism';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { useAuth } from '../../contexts/AuthContext.composition';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useDashboardFeed } from '../shared/dashboard/hooks/useDashboardFeed';
import { usePairedStylists } from '../shared/pairing/hooks/usePairedStylists';
import {
  NavRowListMolecule,
  NavRowMolecule,
} from '../../components/NavRow/NavRow.molecule';
import styles from './AppHomePage.module.css';

interface HomeRow {
  id: string;
  href: string;
  LinkIcon: Icon;
  title: string;
  desc: string;
}

/** Ile wizytówek stylistek wchodzi do listy, zanim zrobi się z niej katalog. */
const MAX_STYLIST_ROWS = 3;

/* DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
 * wiersze rysuje WSPÓLNY prymityw (NavRowMolecule w NavRowListMolecule), bez
 * lokalnej kopii. Ten ekran miał własną listę z kwadratowymi rogami i ramą
 * obok zaokrąglonych kart reszty produktu („Co dalej” wyglądało na inny
 * program). Wygląd wiersza rozstrzyga prymityw, w jednym miejscu dla całej
 * aplikacji; ekran podaje tylko treść. */
function HomeRowLink({ row }: { row: HomeRow }) {
  const { href, LinkIcon, title, desc } = row;
  return (
    <NavRowMolecule
      href={href}
      icon={<LinkIcon size={20} weight='regular' />}
      label={title}
      description={desc}
      trailing='disc'
    />
  );
}

/**
 * Wizytówki stylistek, z którymi klientka jest połączona — JEDYNY produktowy
 * cel, jaki ma na desktopie.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Trasy produktowe (`/app/gallery`, `/app/favorites`, `/app/pairing`) odbijają
 * desktop na `/get-app` (`route-access.policy`), więc lista klientki potrafiła
 * pokazać wyłącznie konto i pomoc: dwa ustawienia i zero produktu. Publiczny
 * profil `/stylist/[identifier]` jest kategorii `static`, czyli osiągalny na
 * każdym viewporcie, i pokazuje dokładnie to, po co klientka przychodzi:
 * przypięte prace jej stylistki. Komponent jest montowany TYLKO w wariancie
 * klientki, bo `usePairedList` dociąga wszystkie strony par — u stylistki
 * (para = jej klientki) byłby to ruch po dane, których ten ekran nie pokazuje.
 * Pary nieaktywne odpadają: ich profil już nie istnieje.
 */
function ClientStylistRows() {
  const t = useTranslations('pages.appHome');
  const { pairs } = usePairedStylists();

  return (
    <>
      {pairs
        .filter(pair => !pair.isInactive)
        .slice(0, MAX_STYLIST_ROWS)
        .map(pair => (
          <HomeRowLink
            key={pair.stylistAccountId}
            row={{
              id: pair.stylistAccountId,
              href: buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
                identifier: pair.stylistAccountId,
              }),
              LinkIcon: StorefrontIcon,
              // Wizytówka bez nazwy wyświetlanej istnieje (nazwa jest opcjonalna),
              // a pusty tytuł zostawiłby wiersz z samym opisem.
              title: pair.stylistDisplayName.trim() || t('stylistFallbackName'),
              desc: t('stylistDesc'),
            }}
          />
        ))}
    </>
  );
}

/**
 * Web-home strefy `/app` — ekran startowy zalogowanego DESKTOPU.
 *
 * DECISION (nie usuwaj tego komentarza) — owner 2026-09-09:
 * Do tej pory zalogowany na laptopie po samouczku lądował prosto w formularzu
 * ustawień (`/app/user/account`) i nie wiedział, co dalej: „obiecywali mi
 * aplikację, a widzę panel operacyjny". Ten ekran odpowiada na to jednym
 * banerem — TYM SAMYM komponentem co hero `/get-app` (`GetAppHero`, wspólny
 * z założenia, żeby edycja szła w oba miejsca naraz) — i krótką listą tego,
 * co na dużym ekranie faktycznie ma sens: wizytówka, konto, rozliczenia,
 * pomoc. Produkt (galeria, klientki, sesje) zostaje mobile-only.
 *
 * Trasa jest `account-route` (`route-access.policy`), więc desktop jej NIE
 * bounce'uje na `/get-app`; na telefonie ekran nie ma racji bytu — tam startem
 * jest pełny dashboard `/app`, więc wąski viewport wraca tam replace'em.
 *
 * DECISION (nie usuwaj tego komentarza) — 2026-09-09, druga runda:
 * Ekran idzie za AKTYWNĄ ROLĄ (`account-surface.policy`, ten sam SSOT co rail
 * i ekran konta), a nie za posiadaniem konta stylistki, i CZEKA na jej
 * rozstrzygnięcie: baner klientki i baner stylistki mówią zupełnie co innego,
 * więc mignięcie cudzym wariantem byłoby tym samym błędem, który tu naprawiamy.
 * Hero dostaje też własną akcję — na `/app/home` przyciski sklepów nie mają
 * sensu (użytkownik jest zalogowany, na desktopie, a Play jeszcze nie wystawia
 * aplikacji, więc jedyny przycisk banera był WYŁĄCZONY i baner nie prowadził
 * donikąd). Zamiast martwego przycisku: jedna żywa akcja tej roli.
 */
function AppHomePageInner() {
  const router = useRouter();
  const t = useTranslations('pages.appHome');
  const tButtons = useTranslations('buttons');
  const { accountType } = useAuth();
  const {
    data: currentUser,
    isError: isAccountError,
    isFetching: isAccountFetching,
    refetch: refetchAccount,
  } = useCurrentUserAccount();
  const { feed, isError: isFeedError } = useDashboardFeed(
    accountType === AccountTypeValue.STYLIST &&
      currentUser?.stylist_account != null
  );

  // Zatrzask jednorazowy (wzorzec `redirectFired` z useOnboardingPlanGuard):
  // decyzja zapada RAZ, przy wejściu na ekran. Bez niego każde ponowne
  // uruchomienie efektu (zmiana tożsamości routera, remount) mogłoby odbić
  // użytkownika w środku pracy, gdyby akurat trafiło na chwilowo wąski pomiar.
  const bouncedRef = useRef(false);

  // Rola sesji nie istnieje w HTML-u z builda (strona jest statyczna, token
  // żyje w localStorage), więc pierwszy render KLIENTA musi być identyczny
  // z serwerowym — inaczej React zgłasza hydration mismatch i przerysowuje
  // drzewo. Prerenderujemy więc szkielet i wchodzimy w treść dopiero po
  // montażu, gdy znamy rolę. Ekran jest za loginem, więc statyczny HTML nie
  // ma tu nic do pokazania.
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || bouncedRef.current) {
      return;
    }
    // Pomiar PO montażu (window.innerWidth jest wtedy prawdziwy) — useDesktopAccess
    // startuje z 0 i przez pierwszy render wygląda jak mobile, więc czytanie go
    // tutaj wysyłałoby desktop na /app w każdym wejściu.
    if (window.innerWidth >= DESKTOP_FRAME_MIN_WIDTH) {
      return;
    }
    bouncedRef.current = true;
    void runInstant(
      'app-home:mobile-has-full-product',
      () => router.replace(ROUTES_FRONT.APP),
      ROUTES_FRONT.APP
    );
  }, [router]);

  const hasStylistAccount = currentUser?.stylist_account != null;
  const surface = resolveAccountSurface({
    activeRole: accountType,
    hasStylistAccount,
    hasClientAccount: currentUser?.client_account != null,
  });
  const inStylistMode = surface.showStylistSections;

  // DECISION (nie usuwaj tego komentarza) — CZEKAMY NA UZYTKOWNICZKE, NIE NA FLAGE:
  // `isAccountLoading` opada rowniez przy BLEDZIE kwerendy, a wtedy `currentUser`
  // zostaje `undefined` → `hasStylistAccount` false → `resolveAccountSurface` gasi
  // sekcje stylistki i ekran proponuje jej „Zostan stylistka", czyli konto, ktore
  // ona juz ma. Kanon tego repo rozstrzyga po SAMEJ WARTOSCI (ClientCardPage:
  // „Strona zyje za auth-guardem AppLayout, wiec user zawsze sie rozwiaze"), bo
  // dopoki nie wiadomo, kim jest uzytkowniczka, zaden wariant roli nie jest
  // bezpieczny do pokazania.
  // Blad kwerendy MUSI miec wlasna galaz, inaczej bramka ponizej („czekamy na
  // uzytkowniczke") zamienia awarie w WIECZNY szkielet: `refetchOnWindowFocus`
  // jest wylaczone, a ponowienia sa ograniczone, wiec nic samo nie wroci.
  // Cytowany kanon z ClientCardPage („brak ryzyka wiecznego skeletonu") opisuje
  // 401 — token znika i auth-guard odsyla; przy 5xx albo zerwanej sieci token
  // zostaje i nikt nikogo nie odsyla.
  // Warunek obejmuje `currentUser === undefined`, bo TanStack ustawia status bledu
  // ZACHOWUJAC dane: bez tego nieudane odswiezenie w tle zamienialoby dzialajacy
  // ekran w komunikat o bledzie. Blad pokazujemy, gdy nie ma czego pokazac.
  if (isHydrated && isAccountError && currentUser === undefined) {
    return (
      <div className={styles.page}>
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void refetchAccount()}
          isRetrying={isAccountFetching}
        />
      </div>
    );
  }

  if (!isHydrated || currentUser === undefined) {
    // Kształt szkieletu = kształt ekranu (baner + lista), więc rozstrzygnięcie
    // roli nie przesuwa treści pod kursorem.
    return (
      <div className={styles.page}>
        <SkeletonAtom variant='rect' width='100%' height={420} />
        <SkeletonAtom variant='rect' width='100%' height={240} />
      </div>
    );
  }

  const stylistRows: readonly HomeRow[] = [
    {
      id: 'profile',
      href: ROUTES_FRONT.STYLIST_PROFILE_MANAGE,
      LinkIcon: StorefrontIcon,
      title: t('profileTitle'),
      desc: t('profileDesc'),
    },
    {
      id: 'account',
      href: ROUTES_FRONT.USER_ACCOUNT,
      LinkIcon: UserCircleIcon,
      title: t('accountTitle'),
      desc: t('accountDesc'),
    },
    {
      id: 'billing',
      href: ROUTES_FRONT.USER_ACCOUNT_PAY,
      LinkIcon: CreditCardIcon,
      title: t('billingTitle'),
      desc: t('billingDesc'),
    },
    {
      id: 'support',
      href: ROUTES_FRONT.SUPPORT,
      LinkIcon: LifebuoyIcon,
      title: t('supportTitle'),
      desc: t('supportDesc'),
    },
  ];

  // Klientka: konto i pomoc, a przed nimi produkt (wizytówki jej stylistek).
  // Zaproszenie do konta stylistki tylko dla kogoś, kto go NIE ma — parytet
  // z `offerMissingRole` na ekranie konta.
  const clientRows: readonly HomeRow[] = [
    {
      id: 'account',
      href: ROUTES_FRONT.USER_ACCOUNT,
      LinkIcon: UserCircleIcon,
      title: t('accountTitle'),
      desc: t('accountDesc'),
    },
    {
      id: 'support',
      href: ROUTES_FRONT.SUPPORT,
      LinkIcon: LifebuoyIcon,
      title: t('supportTitle'),
      desc: t('supportDesc'),
    },
    ...(hasStylistAccount
      ? []
      : [
          {
            id: 'become-stylist',
            href: ROUTES_FRONT.USER_ACTIVATE_STYLIST,
            LinkIcon: BriefcaseIcon,
            title: t('becomeStylistTitle'),
            desc: t('becomeStylistDesc'),
          },
        ]),
  ];

  const rows = inStylistMode ? stylistRows : clientRows;
  // Public page is ready once a work is pinned (same measure as the
  // activation step). Until the feed resolves, do not flash the setup CTA.
  const profileKnown = feed != null || isFeedError;
  const profileReady = feed != null && feed.pinned_count >= 1;

  return (
    <div className={styles.page}>
      <GetAppHeroOrganism
        headingId='app-home-heading'
        className={styles.hero}
        variant={inStylistMode ? 'app-stylist' : 'app-client'}
        actions={
          inStylistMode ? (
            profileReady ? (
              <p className={styles.heroNote}>{t('heroProfileReady')}</p>
            ) : profileKnown ? (
              <LinkButtonAtom
                href={ROUTES_FRONT.STYLIST_PROFILE_MANAGE}
                variant='primary'
                size='lg'>
                {t('heroCtaStylist')}
              </LinkButtonAtom>
            ) : null
          ) : (
            <LinkButtonAtom
              href={ROUTES_FRONT.USER_ACCOUNT}
              variant='primary'
              size='lg'>
              {t('heroCtaClient')}
            </LinkButtonAtom>
          )
        }
      />

      <section className={styles.next} aria-labelledby='app-home-next'>
        <div className={styles.nextHead}>
          <TypographyAtom variant='h2' id='app-home-next'>
            {t('nextTitle')}
          </TypographyAtom>
          <TypographyAtom variant='body2' color='var(--color-text-secondary)'>
            {inStylistMode ? t('nextLedeStylist') : t('nextLedeClient')}
          </TypographyAtom>
        </div>

        <NavRowListMolecule ariaLabel={t('nextTitle')}>
          {!inStylistMode && <ClientStylistRows />}
          {rows.map(row => (
            <HomeRowLink key={row.id} row={row} />
          ))}
        </NavRowListMolecule>
      </section>
    </div>
  );
}

export function AppHomePageComposition() {
  const t = useTranslations('pages.appHome');
  return (
    <AppLayoutComposition title={t('appBarTitle')}>
      <AppHomePageInner />
    </AppLayoutComposition>
  );
}
