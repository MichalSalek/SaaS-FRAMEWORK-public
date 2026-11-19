import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { text } from './email-template.bodies';

/** Optional place and note, escaped inside `text`. Omitted when the client left them empty. */
export const pairRequestAfterBody = (
  vars: Record<string, string>,
  locale: LocaleType
): string => {
  const parts: string[] = [];
  if ((vars['place'] ?? '').trim().length > 0) {
    parts.push(text('pair-request-notification', 'placeLine', locale, vars));
  }
  if ((vars['note'] ?? '').trim().length > 0) {
    parts.push(text('pair-request-notification', 'noteLine', locale, vars));
  }
  return parts.join('\n\n');
};
