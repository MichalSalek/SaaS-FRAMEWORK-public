/**
 * Skladanie list docelowych wystawy demo (wizyty, watki wiadomosci).
 *
 * Czyste funkcje, zero IO: orkiestrator (demo-content-seeding.operations.ts)
 * dobil do sufitu `max-lines`, a to sa jedyne jego fragmenty, ktore niczego nie
 * zapisuja — przeliczaja tylko specyfikacje na liste celow. Dlatego siedza
 * w `.targets.ts`, a nie `.server.ts`: helper, ktory nie ma efektu ubocznego,
 * ma byc testowalny bez bazy.
 */
import type { DemoClientAccounts } from './demo-content-seeding.clients';
import { requireDemoClient } from './demo-content-seeding.clients';
import { DEMO_NEW_CLIENTS } from './demo-content-seeding.clients-data';
import type { VisitTarget } from './demo-content-seeding.visits';
import type { MessageThreadTarget } from './demo-content-seeding.messages';
import {
  DEMO_KAROLINA_ANIA_VISITS,
  DEMO_KAROLINA_ANIA_MESSAGES,
  DEMO_KAROLINA_OLA_MESSAGES,
} from './demo-content-seeding.karolina-data';

/** Wizyty: Karolina u Ani + komplet nowych klientek, wszystkie u Ani. */
export const buildDemoVisitTargets = ({
  karolinaUserId,
  aniaAccountId,
  clientsBySlug,
}: {
  karolinaUserId: string;
  aniaAccountId: string;
  clientsBySlug: Map<string, DemoClientAccounts>;
}): VisitTarget[] => [
  {
    clientUserId: karolinaUserId,
    stylistAccountId: aniaAccountId,
    visits: DEMO_KAROLINA_ANIA_VISITS,
  },
  // Brak konta klientki RZUCA (requireDemoClient) — wczesniej cichy `[]` gubil
  // CALA historie wizyt tej klientki przy zielonym komunikacie seeda.
  ...DEMO_NEW_CLIENTS.map(spec => ({
    clientUserId: requireDemoClient(clientsBySlug, spec.slug).userId,
    stylistAccountId: aniaAccountId,
    visits: spec.visits,
  })),
];

/** Watki: Karolina z Ania i z Ola + komplet nowych klientek z Ania. */
export const buildDemoMessageTargets = ({
  karolinaUserId,
  aniaAccountId,
  olaAccountId,
  clientsBySlug,
}: {
  karolinaUserId: string;
  aniaAccountId: string;
  olaAccountId: string;
  clientsBySlug: Map<string, DemoClientAccounts>;
}): MessageThreadTarget[] => [
  {
    clientUserId: karolinaUserId,
    stylistAccountId: aniaAccountId,
    messages: DEMO_KAROLINA_ANIA_MESSAGES,
    unreadFor: 'CLIENT',
  },
  {
    clientUserId: karolinaUserId,
    stylistAccountId: olaAccountId,
    messages: DEMO_KAROLINA_OLA_MESSAGES,
    unreadFor: null,
  },
  // Jak wyzej: chybienie slugu to zlamany niezmiennik, nie brak danych.
  ...DEMO_NEW_CLIENTS.map(spec => ({
    clientUserId: requireDemoClient(clientsBySlug, spec.slug).userId,
    stylistAccountId: aniaAccountId,
    messages: spec.messages,
    unreadFor: spec.stylistUnread ? ('STYLIST' as const) : null,
  })),
];
