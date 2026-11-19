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
 * DECISION: TRANSLATION KEYS ARE NOT CHECKED BY TYPESCRIPT. The only safety net is grep
 * (`npm run copy:grep`) and `npm run i18n:detect-dead`: deleting a key used by `t('foo')` does NOT
 * fail `tsc --noEmit`, next-intl v4 renders the literal dotted path. A global `IntlMessages`
 * interface is the v3 mechanism and does nothing in v4, so do not re-add it. The real augmentation
 * is not enabled: it gives ~127 errors in ~49 files (`t(row.labelKey)` with a `string` key,
 * TS2590 / TS2589 from a union of thousands of keys) and raises compile time from ~15 s to ~52 s.
 * Enabling it is its own migration: (1) a namespace generic on every
 * `ReturnType<typeof useTranslations>`, (2) literal unions for the `*Key` fields in data modules,
 * (3) then this block returns:
 *
 *     declare module 'next-intl' {
 *       interface AppConfig { Locale: (typeof I18N_CONFIG.locales)[number]; Messages: Messages }
 *     }
 */

export const AppConfig = {
  locales: I18N_CONFIG.locales,
  defaultLocale: I18N_CONFIG.defaultLocale,
} as const;
