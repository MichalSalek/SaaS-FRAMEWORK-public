// UI/features/account/ProfileManagePage.composition.tsx
// „Twój publiczny profil" — jedno miejsce, w którym stylistka konfiguruje to,
// co widzi klientka: wizytówkę, adres profilu, kolor marki i przypięte prace.
//
// DECISION (nie usuwaj tego komentarza) — zgłoszenie ownera 2026-09-09:
// (1) Konfiguracja profilu publicznego była wciśnięta jako jedna sekcja w
//     zakładce „Konto" i nikt jej tam nie znajdował („nie ma takiego miejsca do
//     konfigurowania tego publicznego profilu"). Sekcja przeniosła się TUTAJ, a
//     konto zostawiło do niej odnośnik — jeden adres, jeden właściciel tematu.
// (2) Pozycja „Twój publiczny profil" w menu bocznym prowadziła WPROST na
//     `/stylist/[identifier]`, czyli poza powłokę aplikacji: PublicLayout nie ma
//     dolnej belki, a WebView nie ma paska adresu, więc stylistka zostawała
//     uwięziona. Teraz menu prowadzi tutaj, a wyjście na stronę publiczną jest
//     świadomym krokiem z karty udostępniania (plus pasek powrotu w
//     PublicLayout dla natywnej skorupy).
// Trasa jest `account-route`, więc działa też na laptopie — pisanie bio i
// vanity to praca „przy biurku", nie przy stanowisku.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import type { SafeStylistAccount } from '@kernel/models/session/session.dto';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { StorefrontIcon } from '@phosphor-icons/react';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { ProfileShareCardOrganism } from '../shared/profile/ProfileShareCard.organism';
import { StylistProfileSectionOrganism } from './components/StylistProfileSection.organism';
import { PinnedManagerOrganism } from './components/PinnedManager.organism';
import { authClient } from '../../../application/auth/better-auth-client';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useIsStylist } from '../../shared/hooks/useSessionRole';
import styles from './ProfileManagePage.module.css';

function ProfileManagePageInner() {
  const t = useTranslations('account.profileManage');
  const tButtons = useTranslations('buttons');
  useAppBarTitle(t('title'));
  const router = useRouter();
  const {
    data: user,
    isLoading,
    isFetching,
    refetch,
  } = useCurrentUserAccount();
  const isStylist = useIsStylist();
  // Aktywna rola przychodzi z sesji Better Auth. Dopóki sesja jest PENDING,
  // `accountType` jest null i `useIsStylist()` kłamie „nie stylistka" — bez tej
  // bramki ekran odbijał stylistkę na konto przy każdym wejściu.
  const { isPending: isSessionPending } = authClient.useSession();
  const stylistAccount = user?.stylist_account ?? null;

  // DECISION (nie usuwaj — ten sam mount-gate co w AccountPage, S18):
  // ekran jest auth-gated (Bearer token w localStorage), więc SSR ma
  // `isLoading === false` i renderuje pusty stan „to miejsce jest dla
  // stylistek", a pierwszy render kliencki ma już token i renderuje skeleton.
  // Bez tej bramki React zgłasza hydration mismatch i przerysowuje całe
  // poddrzewo. SSR i pierwszy CSR muszą dać IDENTYCZNY skeleton.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Tryb klientki nie ma publicznej wizytówki — trasa jest w uprawnieniach
  // stylistki i admina, ale dwurolowy user może tu wejść zakładką w trybie
  // klientki. Odsyłamy na konto, gdzie stoi karta „przełącz tryb".
  useEffect(() => {
    if (!mounted || isLoading || isSessionPending || isStylist) {
      return;
    }
    void runInstant(
      'profile-manage:not-in-stylist-mode',
      () => router.replace(ROUTES_FRONT.USER_ACCOUNT),
      ROUTES_FRONT.USER_ACCOUNT
    );
  }, [mounted, isLoading, isSessionPending, isStylist, router]);

  if (!mounted || isLoading || isSessionPending) {
    return (
      <div className={styles.page}>
        {/* Pudełka o docelowej geometrii: nagłówek, karta udostępniania,
            sekcja przypiętych prac. */}
        <SkeletonAtom variant='rect' width='100%' height={104} />
        <SkeletonAtom variant='rect' width='100%' height={288} />
        <SkeletonAtom variant='rect' width='100%' height={360} />
      </div>
    );
  }

  // DECISION (nie usuwaj tego komentarza) — BLAD KWERENDY TO NIE „NIE JESTES STYLISTKA":
  // `isLoading` opada rowniez przy bledzie, a wtedy `user` zostaje `undefined`,
  // `stylistAccount` wychodzi `null` i ekran orzekal o uzytkowniczce cos, czego
  // nie zmierzyl — parkowal prawdziwa stylistke na komunikacie „to miejsce jest
  // dla stylistek". Odsylacz na konto tez nie ratowal, bo `isStylist` z sesji jest
  // wtedy `true` i efekt przekierowania wychodzi wczesniej. Nierozstrzygniete
  // pokazujemy jako blad z ponowieniem, a nie jako werdykt o roli.
  // Warunkiem jest SAM BRAK DANYCH, nie `isError`: TanStack ustawia status bledu
  // zachowujac dane, wiec nieudane odswiezenie w tle wyrzucaloby uzytkowniczke
  // z dzialajacego edytora wizytowki.
  if (user === undefined) {
    return (
      <div className={styles.page}>
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      </div>
    );
  }

  if (!isStylist || stylistAccount === null) {
    return (
      <div className={styles.page}>
        <EmptyStateAtom
          size='page'
          icon={<StorefrontIcon size={32} weight='duotone' />}
          title={t('noStylistTitle')}
          titleAs='h2'
          description={t('noStylistBody')}
          action={
            <LinkButtonAtom
              href={ROUTES_FRONT.USER_ACCOUNT}
              variant='primary'
              size='md'>
              {t('noStylistCta')}
            </LinkButtonAtom>
          }
        />
      </div>
    );
  }

  return <ProfileManageBody stylistAccount={stylistAccount} />;
}

/* DECISION (nie usuwaj tego komentarza) — S126, owner 2026-10-08 („nie prowadzi
 * mnie do głównej akcji”, „wykorzystaj szerokość”):
 * (1) GŁÓWNA AKCJA ekranu to „Udostępnij” w karcie udostępniania: wizytówkę
 *     ustawia się raz, a wraca się tu po to, żeby wysłać link i przełożyć
 *     przypięte prace. Dlatego kolejność na telefonie to udostępnianie,
 *     przypięte prace, formularz, a wszystko poza „Udostępnij” jest obrysowane.
 * (2) Konto BEZ adresu nie ma czego udostępniać: karty wtedy nie ma (jej
 *     jedyny przycisk prowadził na ten sam ekran), a formularz idzie na górę z
 *     polem adresu i wypełnionym „Ustaw adres”. Ten wybór jest zatrzaśnięty
 *     przy montowaniu, żeby po zapisaniu adresu nic nie przeskoczyło pod
 *     palcem; karta udostępniania pojawia się wtedy POD formularzem.
 * (3) Od 720px własnej szerokości dwie kolumny: po lewej to, co robi się tu
 *     na co dzień (udostępnianie i siatka zdjęć, która potrzebuje szerokości),
 *     po prawej formularz, którego pola dobrze czytają się w wąskiej kolumnie.
 * (4) Meta nagłówka niesie tylko odsłony. Adres stoi w karcie udostępniania, a
 *     liczba przypiętych w nagłówku ich sekcji: jeden fakt, jedno miejsce. */
function ProfileManageBody({
  stylistAccount,
}: {
  stylistAccount: SafeStylistAccount;
}) {
  const t = useTranslations('account.profileManage');
  const hasAddress = Boolean(stylistAccount.vanity_url);
  const [formLeads] = useState(() => !hasAddress);

  return (
    <div className={styles.page}>
      <AppHeroOrganism
        title={t('title')}
        meta={
          <span>{t('metaViews', { count: stylistAccount.view_count })}</span>
        }
      />

      <PageColumnsMolecule
        asideSize='wide'
        narrowFirst={formLeads ? 'aside' : 'main'}
        main={
          <>
            {hasAddress && <ProfileShareCardOrganism />}
            <PinnedManagerOrganism />
          </>
        }
        aside={
          <StylistProfileSectionOrganism stylistAccount={stylistAccount} />
        }
      />
    </div>
  );
}

export function ProfileManagePageComposition() {
  const t = useTranslations('account.profileManage');
  return (
    <AppLayoutComposition title={t('title')}>
      <ProfileManagePageInner />
    </AppLayoutComposition>
  );
}
