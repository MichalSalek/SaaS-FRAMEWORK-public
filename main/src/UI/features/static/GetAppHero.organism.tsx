import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { LpHeroOrganism } from '../../components/LpHero/LpHero.organism';
import { PhoneMockupMolecule } from '../../components/PhoneMockup/PhoneMockup.molecule';
import { useAppScreenshots } from '../../assets/useAppScreenshots';
import { GetAppStoreButtonsMolecule } from './GetAppStoreButtons.molecule';
import styles from './GetAppHero.module.css';

/**
 * Scroll target on the hero store-buttons wrapper — funnel CTAs in 'get-app'
 * mode scroll here instead of navigating to login.
 */
export const GET_APP_STORES_ANCHOR_ID = 'getapp-stores';

/**
 * Do kogo mówi baner i na jakiej powierzchni stoi.
 *
 * 'public'      — publiczna `/get-app`: kanon (sklepy pod telefonami, głos
 *                 sprzedażowy do stylistki, która jeszcze nie ma konta).
 * 'app-stylist' — web-home zalogowanej stylistki: bez sklepów, treść mówi do
 *                 kogoś, kto już kupił produkt.
 * 'app-client'  — web-home zalogowanej klientki: treść i ekrany klientki.
 */
export type GetAppHeroVariant = 'public' | 'app-stylist' | 'app-client';

export interface GetAppHeroProps {
  /** id headline'u — sekcja dostaje aria-labelledby. Wymagane: baner jest
   *  nagłówkiem swojej powierzchni, a każda strona ma własne id. */
  headingId: string;
  /** Skórka powierzchni-gospodarza (np. wyjście z full-bleed w /app). */
  className?: string;
  /** Domyślnie kanon publiczny — `/get-app` nie podaje wariantu. */
  variant?: GetAppHeroVariant;
  /** Akcja hero na powierzchniach `app-*`; tam nie ma przycisków sklepów. */
  actions?: ReactNode;
}

/**
 * GetAppHero — hero „Nailfolio bierzesz na telefon": kolaż dwóch telefonów
 * (gallery + conversation, editorial offset) i przyciski sklepów
 * POD produktem.
 *
 * DECISION (nie usuwaj tego komentarza) — owner 2026-09-09:
 * JEDEN komponent obsługuje DWIE powierzchnie: publiczną `/get-app` i web-home
 * zalogowanego desktopu `/app/home`. Owner poprosił wprost o „ten sam
 * komponent, tę samą sekcję", żeby zmiana banera zmieniała oba miejsca naraz.
 * Trzecie miejsce montuje ten komponent, NIE kopiuje JSX-a.
 * Konsekwencja dla floora: chip-eyebrow, którego kanon intro ekranów aplikacji
 * zakazuje (DESIGN.md §App Layout Decisions), zostaje tutaj świadomie — to
 * baner produktowy wstawiony w `/app`, nie `AppHero` tamtego ekranu.
 *
 * DECISION (nie usuwaj tego komentarza) — wariant zamiast forka (2026-09-09):
 * „ta sama sekcja" nie znaczy „ta sama treść dla każdego". Zalogowana KLIENTKA
 * dostawała na `/app/home` hero sprzedażowe do stylistki: nagłówek „wszystko
 * o Twoich klientkach", lede o galerii własnych prac, nota o 30 dniach Pro
 * i zrzut cudzego panelu z IMIENIEM demo-stylistki na całą szerokość ekranu.
 * Dlatego treść, ekrany w telefonach i akcja idą za `variant`, a nie są
 * duplikowane w drugim komponencie — publiczna `/get-app` zostaje wariantem
 * domyślnym i bitowo tą samą powierzchnią co przedtem.
 *
 * i18n: namespace `static.getApp` — `hero.*` (kanon publiczny) i
 * `heroInApp.{stylist,client}.*` (powierzchnia `/app`), plus `pages.home`
 * (etykieta drugiego telefonu w kolażu stylistki). Namespace `static.getApp`
 * ładują OBIE strony-gospodarze, więc wariantowa treść żyje w jednej
 * przestrzeni: gałąź `app-*` nie może zależeć od namespace'u, którego
 * `/get-app` nie ładuje.
 */
export function GetAppHeroOrganism({
  headingId,
  className,
  variant = 'public',
  actions,
}: GetAppHeroProps) {
  const t = useTranslations('static.getApp');
  const appScreen = useAppScreenshots();
  // Shared translated labels describe the conversation in the second phone.
  const tHomeBenefits = useTranslations('pages.home.benefits');

  const isPublic = variant === 'public';
  const isClient = variant === 'app-client';

  // Klucze literalne (nie sklejane) — typowane komunikaty next-intl.
  const copy = isPublic
    ? {
        eyebrow: t('hero.eyebrow'),
        headline: t('hero.headlineLine1'),
        accent: t('hero.headlineAccent'),
        lede: t('hero.lede'),
        meta: t('hero.freeNote'),
      }
    : isClient
      ? {
          eyebrow: t('heroInApp.client.eyebrow'),
          headline: t('heroInApp.client.headlineLine1'),
          accent: t('heroInApp.client.headlineAccent'),
          lede: t('heroInApp.client.lede'),
          meta: t('heroInApp.client.meta'),
        }
      : {
          eyebrow: t('heroInApp.stylist.eyebrow'),
          headline: t('heroInApp.stylist.headlineLine1'),
          accent: t('heroInApp.stylist.headlineAccent'),
          lede: t('heroInApp.stylist.lede'),
          meta: t('heroInApp.stylist.meta'),
        };

  // Kolaż: klientka widzi SWOJE ekrany (sesje + panel klientki). Zrzut galerii
  // stylistki jest podpisany nazwiskiem demo-konta wypalonym w bitmapie, więc
  // na powierzchni klientki byłby cudzą tożsamością na pół ekranu.
  const collage = isClient ? (
    <div className={styles.collage}>
      <div className={styles.collagePrimary}>
        <PhoneMockupMolecule
          label={t('heroInApp.client.mockupLabel')}
          route='/app/sessions'
          state={t('heroInApp.client.mockupState')}
          size='lg'
          screenshot={appScreen('appClientSessions')}
        />
      </div>
      <div className={styles.collageSecondary}>
        <PhoneMockupMolecule
          label={t('heroInApp.client.mockupSecondaryLabel')}
          route='/app'
          state={t('heroInApp.client.mockupSecondaryState')}
          size='md'
          screenshot={appScreen('appClientHome')}
        />
      </div>
    </div>
  ) : (
    <div className={styles.collage}>
      <div className={styles.collagePrimary}>
        <PhoneMockupMolecule
          label={t('hero.mockupLabel')}
          route='/app'
          size='lg'
          screenshot={appScreen('appDashboard')}
        />
      </div>
      <div className={styles.collageSecondary}>
        <PhoneMockupMolecule
          label={tHomeBenefits('conversationLabel')}
          route='/app/messages'
          state={tHomeBenefits('conversationState')}
          size='md'
          screenshot={appScreen('appThread')}
        />
      </div>
    </div>
  );

  return (
    <LpHeroOrganism
      eyebrow={copy.eyebrow}
      headline={copy.headline}
      headlineAccent={copy.accent}
      lede={copy.lede}
      actions={actions}
      meta={<span>{copy.meta}</span>}
      headingId={headingId}
      className={clsx(className)}
      media={
        isPublic ? (
          <div className={styles.mediaWithStores}>
            {collage}
            <div id={GET_APP_STORES_ANCHOR_ID} className={styles.storesAnchor}>
              <GetAppStoreButtonsMolecule />
            </div>
          </div>
        ) : (
          collage
        )
      }
    />
  );
}
