// UI/features/auth/components/OnboardingProfilePreview.molecule.tsx
//
// S123 — żywy podgląd publicznej wizytówki na kroku DANE.
//
// Po co istnieje: onboarding przez pięć kroków prosił o dane i ani razu nie
// pokazywał, co z nich powstaje. Krok mówił tylko „powiedz klientkom, kim
// jesteś", więc obca stylistka nie wiedziała, że buduje STRONĘ pod własnym
// linkiem. Podgląd wypełnia się w trakcie pisania i jest jedynym miejscem w
// całym lejku, w którym widać produkt, a nie formularz.
//
// DECISION (nie usuwaj tego komentarza):
// 1. Kształt jest PORTRETEM realnej wizytówki `/stylist/[identifier]`, nie nową
//    kompozycją: biała karta, ciemny krążek z inicjałami, nazwa, pod nią wiersz
//    z miastem. Jeśli nagłówek profilu publicznego kiedyś się zmieni, ten
//    podgląd trzeba przerysować razem z nim, inaczej obiecuje coś, czego nie ma.
// 2. Inicjały liczymy lokalnie, we własnym krążku. Powód historyczny: do S126
//    `Avatar.atom` bez `src` pobierał obrazek z zewnętrznego serwisu z nazwą
//    w query-stringu, a tu nazwa zmienia się z KAŻDYM naciśnięciem klawisza.
//    Atom rysuje już inicjały sam, ale krążek zostaje własny, bo jest częścią
//    portretu nagłówka wizytówki (punkt 1), nie zwykłym awatarem wiersza.
// 3. Puste pola pokazują podpowiedź wyciszoną (`data-empty`), nie pustkę:
//    karta ma trzymać rozmiar od pierwszej klatki, żeby wpisywanie nie
//    przesuwało treści pod palcem.
// 4. Karta niesie SAMĄ tożsamość (krążek, nazwa, miasto) i ani linijki więcej.
//    Pierwsza wersja miała jeszcze wiersz „tu staną Twoje prace" i notkę o
//    wklejeniu linku w bio: razem 126 px, przez które pierwsze pole formularza
//    schodziło POD zagięcie przy 390 px (zmierzone: wejście „imię" na 857 przy
//    widoku 787). Ekran, na którym nie widać ani jednego pola, a widać przycisk
//    „Dalej", produkuje pusty submit i potrząśnięcie walidacji. Notka o bio
//    przeniosła się do podtytułu kroku, a wiersz o pracach zniknął: realny
//    nagłówek profilu publicznego też niesie samą tożsamość.

import { useTranslations } from 'next-intl';
import { MapPinIcon } from '@phosphor-icons/react';
import styles from '../OnboardingPage.module.css';

interface OnboardingProfilePreviewProps {
  /** Aktualna wartość pola „Imię / nazwa publiczna" (może być pusta). */
  displayName: string;
  /** Aktualna wartość pola „Miasto" (może być pusta). */
  city: string;
}

/** Inicjały liczone lokalnie (patrz DECISION 2): maks. dwa znaki, wielkie. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '';
  }
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase();
}

export function OnboardingProfilePreviewMolecule({
  displayName,
  city,
}: OnboardingProfilePreviewProps) {
  const t = useTranslations('pages.onboarding');

  const name = displayName.trim();
  const cityName = city.trim();
  const initials = initialsOf(name);

  return (
    <div className={styles.preview}>
      <p className={styles.previewLabel}>{t('previewTitle')}</p>

      <div className={styles.previewCard}>
        <div className={styles.previewIdentity}>
          {/* Pusty krążek w atramencie czytałby się jak zepsuty element, więc
              do czasu wpisania nazwy stoi na neutralnej powierzchni kontrolki. */}
          <span
            className={styles.previewAvatar}
            data-empty={initials === '' ? 'true' : undefined}
            aria-hidden='true'>
            {initials}
          </span>
          <span className={styles.previewLines}>
            <span
              className={styles.previewName}
              data-empty={name === '' ? 'true' : undefined}>
              {name === '' ? t('previewNamePlaceholder') : name}
            </span>
            <span
              className={styles.previewCity}
              data-empty={cityName === '' ? 'true' : undefined}>
              <MapPinIcon size={15} weight='fill' aria-hidden='true' />
              {cityName === '' ? t('previewCityPlaceholder') : cityName}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
