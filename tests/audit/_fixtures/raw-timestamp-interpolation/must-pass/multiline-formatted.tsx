// Compliant and multi-line: the formatter runs before interpolation. This must NOT
// trip the guard — otherwise the rewrite would flag the project's own convention.
declare function t(key: string, values?: Record<string, unknown>): string;
declare function formatDate(iso: string, locale: string): string;
declare const stylist: { paired_at: string };
declare const locale: string;

export function pairedLabel(): string {
  return t('pairedAt', {
    date: formatDate(stylist.paired_at, locale),
  });
}
