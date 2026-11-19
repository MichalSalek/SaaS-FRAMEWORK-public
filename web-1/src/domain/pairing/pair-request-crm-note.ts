import {
  getLocaleOrDefault,
  I18N_CONFIG,
  type LocaleType,
} from '@kernel/domain/i18n/i18n.config';
import { batchResolveLocales } from '@app/email-handler/lifecycle/email-locale-batch.resolver';
import type { Prisma } from '../../prisma/js-client';

const LABELS = {
  pl: {
    heading: 'Prośba klientki o połączenie',
    place: 'Przybliżona lokalizacja',
    note: 'Wiadomość klientki',
  },
  en: {
    heading: 'Client connection request',
    place: 'Approximate location',
    note: 'Client message',
  },
  de: {
    heading: 'Verbindungsanfrage der Kundin',
    place: 'Ungefährer Standort',
    note: 'Nachricht der Kundin',
  },
} as const satisfies Record<
  LocaleType,
  Record<'heading' | 'place' | 'note', string>
>;

export type PairRequestCrmContext = {
  crm_note: string | null;
  crm_note_updated_at: Date | null;
  request_place: string | null;
  request_note: string | null;
  paired_at: Date;
};

/** Appends the client's request without trimming or limiting the stylist's existing text. */
export function pairRequestCrmNoteWrite(
  request: PairRequestCrmContext,
  locale: LocaleType,
  activatedAt: Date
): { crm_note: string; crm_note_updated_at: Date } | Record<string, never> {
  if (!request.request_place && !request.request_note) {
    return {};
  }
  const labels = LABELS[locale];
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: I18N_CONFIG.timezone,
  }).format(request.paired_at);
  const block = [
    `${labels.heading} (${date})`,
    ...(request.request_place
      ? [`${labels.place}: ${request.request_place}`]
      : []),
    ...(request.request_note
      ? [`${labels.note}: ${request.request_note}`]
      : []),
  ].join('\n');
  return {
    crm_note: request.crm_note ? `${request.crm_note}\n\n${block}` : block,
    crm_note_updated_at: new Date(
      Math.max(
        activatedAt.getTime(),
        (request.crm_note_updated_at?.getTime() ?? 0) + 1
      )
    ),
  };
}

export async function pendingPairRequestCrmNoteWrite_IO(
  tx: Prisma.TransactionClient,
  clientUserId: string,
  stylistAccountId: string
): Promise<ReturnType<typeof pairRequestCrmNoteWrite>> {
  const request = await tx.clientStylistPair.findFirst({
    where: {
      client_user_id: clientUserId,
      stylist_account_id: stylistAccountId,
      status: 'PENDING',
    },
    select: {
      crm_note: true,
      crm_note_updated_at: true,
      request_place: true,
      request_note: true,
      paired_at: true,
      stylist_account: { select: { created_by_user_id: true } },
    },
  });
  if (!request || (!request.request_place && !request.request_note)) {
    return {};
  }
  const stylistUserId = request.stylist_account.created_by_user_id;
  const locales = await batchResolveLocales([stylistUserId]);
  return pairRequestCrmNoteWrite(
    request,
    getLocaleOrDefault(locales.get(stylistUserId)),
    new Date()
  );
}
