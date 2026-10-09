import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import type plCommon from '../locales/pl/common.json';
import type plEvents from '../locales/pl/events.json';

// Locale union — SSOT is the kernel i18n config.
export type Locale = (typeof I18N_CONFIG.locales)[number];

/**
 * Shape of the merged message tree handed to next-intl (common.json at the root
 * + events.json under `events`, exactly as `i18n.loader.ts` assembles it).
 * Consumed as an ARGUMENT type by everything that reads messages directly
 * (`resolveMsgKey`, the JSON-LD builders in getStaticProps, the loader itself).
 */
type Messages = typeof plCommon & { events: typeof plEvents };

export type IntlMessages = Messages;

/*
 * DECISION (nie usuwaj tego komentarza) -- 2026-09-10:
 *
 * KLUCZE TLUMACZEN NIE SA SPRAWDZANE PRZEZ TYPESCRIPT. Jedyna siatka
 * bezpieczenstwa to grep (`npm run copy:grep`) i `npm run i18n:detect-dead`.
 * Skasowanie klucza uzywanego przez `t('foo')` NIE wywali `tsc --noEmit` —
 * next-intl v4 wyrenderuje uzytkownikowi doslowna sciezke kropkowa jako tekst.
 *
 * Stal tu wczesniej blok, ktory OBIECYWAL cos przeciwnego:
 *
 *     declare global { interface IntlMessages extends Messages {} }
 *
 * To mechanizm next-intl v3. Wersja 4 (tu: 4.11.1) nie czyta juz globalnego
 * `IntlMessages` — czyta augmentacje `declare module 'next-intl' { interface
 * AppConfig { Messages: … } }` (`use-intl/dist/types/core/AppConfig.d.ts`).
 * Blok byl wiec martwa deklaracja udajaca gwarancje: kolejny agent czytal
 * „type safe message keys", ufal typom zamiast grepowac i kasowal zywe copy.
 * Falszywa obietnica jest gorsza niz jej brak, wiec jej tu nie ma.
 *
 * DLACZEGO NIE WLACZAMY TEGO NA PRAWDE (zmierzone 2026-09-10, nie oszacowane):
 * po dopisaniu poprawnej augmentacji `AppConfig` `tsc --noEmit` w `main/` daje
 * 127 bledow w 49 plikach:
 *   - 123x TS2345 — `t(row.labelKey)` / `t(item.questionKey)`: klucz przychodzi
 *     z modulu danych jako `string`. Kazde takie miejsce wymaga zwezenia typu
 *     pola do unii literalow albo `as` (a `as` przywraca dokladnie ta sama
 *     fikcje, ktora tu usuwamy).
 *   -   2x TS2322 — `locale: string` w `_app.tsx` i w `renderWithProviders`.
 *   -   1x TS2590 „union type too complex" i 1x TS2589 „instantiation
 *     excessively deep": przy 4858 kluczach `useTranslations()` BEZ namespace'u
 *     produkuje unie ~5400 elementow, ktorej TS nie potrafi juz reprezentowac.
 *     Tego NIE naprawiaja poprawki w miejscach wywolan — dopoki istnieje
 *     `ReturnType<typeof useTranslations>` bez generyka, gwarancja i tak jest
 *     dziurawa.
 * Koszt czasu kompilacji: 15 s -> 52 s (3,5x) na kazdym `tsc`, `next build`
 * i podpowiedzi w edytorze.
 *
 * WLACZENIE JEST MOZLIWE, ale to osobna, swiadoma migracja, nie efekt uboczny
 * innej roboty. Kolejnosc: (1) kazdy `ReturnType<typeof useTranslations>`
 * dostaje generyk z namespace'em, (2) pola `*Key` w modulach danych
 * (`ComparePageData`, `PricingPageData`, `HelpCenter*`) dostaja unie literalow
 * zamiast `string`, (3) dopiero potem wraca blok ponizej.
 *
 * SPROSTOWANIE (przeglad S113): staly tu przyklad, jakoby probna augmentacja
 * znalazla martwe wywolanie `pages.privacy.sections.qrPairing.callout`. To NIEPRAWDA
 * i zostalo sprawdzone na zywej stronie: `CALLOUT_SECTIONS` w `PrivacyPage.composition`
 * to `{dataCollection, userRights}`, oba maja `callout` we wszystkich trzech jezykach,
 * a `qrPairing` nalezy do innej tablicy i tego klucza nigdy nie wola. Zdanie zostawione
 * jako ostrzezenie: to byl dokladnie ten blad, ktorego ten plik ma pilnowac —
 * komentarz opisujacy znalezisko, ktorego w kodzie nie ma.
 *
 *     declare module 'next-intl' {
 *       interface AppConfig {
 *         Locale: (typeof I18N_CONFIG.locales)[number];
 *         Messages: Messages;
 *       }
 *     }
 */

export const AppConfig = {
  locales: I18N_CONFIG.locales,
  defaultLocale: I18N_CONFIG.defaultLocale,
} as const;
