/**
 * Personal stats line ("12 prac · 3 klientki"). A count of 0 is omitted
 * so the mail never says "0 prac". Both zero → no line.
 */

import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { getStatsLabels, type StatsForm } from './email-template.i18n';

const polishForm = (n: number): 'one' | 'few' | 'many' => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) {
    return 'one';
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'few';
  }
  return 'many';
};

export const formFor = (
  locale: LocaleType,
  n: number
): 'one' | 'few' | 'many' => {
  if (locale === 'pl') {
    return polishForm(n);
  }
  return n === 1 ? 'one' : 'many';
};

const fill = (template: string, n: number): string =>
  template.replace(/\{\{n\}\}/g, String(n));

const labelFor = (
  labels: ReturnType<typeof getStatsLabels>,
  kind: 'works' | 'clients',
  form: 'one' | 'few' | 'many'
): string => {
  const key: StatsForm =
    kind === 'works'
      ? form === 'one'
        ? 'worksOne'
        : form === 'few'
          ? 'worksFew'
          : 'worksMany'
      : form === 'one'
        ? 'clientsOne'
        : form === 'few'
          ? 'clientsFew'
          : 'clientsMany';
  return labels[key];
};

export const renderStatsLine = (
  locale: LocaleType,
  galleryCount: string | undefined,
  pairedClientsCount: string | undefined
): string => {
  const works = Number.parseInt(galleryCount ?? '', 10);
  const clients = Number.parseInt(pairedClientsCount ?? '', 10);
  const labels = getStatsLabels(locale);
  const parts: string[] = [];
  if (Number.isFinite(works) && works > 0) {
    parts.push(fill(labelFor(labels, 'works', formFor(locale, works)), works));
  }
  if (Number.isFinite(clients) && clients > 0) {
    parts.push(
      fill(labelFor(labels, 'clients', formFor(locale, clients)), clients)
    );
  }
  return parts.filter(part => part.length > 0).join(labels.joiner || ', ');
};

/**
 * Plural-aware count in copy: `{{galleryCount#pracę|prace|prac}}` renders
 * "1 pracę", "3 prace", "12 prac". Forms are one|few|many for Polish and
 * one|other for EN/DE (a missing form falls back to the last one). The copy
 * author picks the grammatical case per sentence ("masz 3 prace",
 * "z 3 klientkami"), so the syntax carries whole forms, not suffixes.
 *
 * DECISION (nie usuwaj tego komentarza): a bare `{{galleryCount}} prac` in
 * copy is wrong for 1-4 and 22-24 in Polish ("3 prac", "z 1 klientkami").
 * Every count followed by a noun uses this syntax; the value is a number we
 * produce, so no escaping is involved.
 */
const PLURAL_PLACEHOLDER = /\{\{(\w+)#([^}]+)\}\}/g;

export const expandPluralPlaceholders = (
  template: string,
  vars: Record<string, string>,
  locale: LocaleType
): string =>
  template.replace(
    PLURAL_PLACEHOLDER,
    (_, key: string, formsRaw: string): string => {
      const n = Number.parseInt(vars[key] ?? '', 10);
      if (!Number.isFinite(n)) {
        return '';
      }
      const forms = formsRaw.split('|');
      const form = formFor(locale, n);
      const index = form === 'one' ? 0 : form === 'few' ? 1 : 2;
      const chosen =
        forms[Math.min(index, forms.length - 1)] ??
        forms[forms.length - 1] ??
        '';
      return `${n} ${chosen}`;
    }
  );
