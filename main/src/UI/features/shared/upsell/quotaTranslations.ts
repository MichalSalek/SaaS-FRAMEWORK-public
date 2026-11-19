import { useTranslations } from 'next-intl';

export type QuotaTranslator = (
  key: string,
  values?: Record<string, string | number>
) => string;

/** Quota copy is supplied through the owner-managed locale delta. */
export function useQuotaTranslations(): QuotaTranslator {
  const t = useTranslations('components') as unknown as QuotaTranslator;
  return (key, values) => t(key.replace(/^components\./, ''), values);
}
