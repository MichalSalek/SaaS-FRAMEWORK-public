/**
 * Admin Bulk change-plan → FREE — durable cancel-reconcile rows (dead-letter FIRST).
 *
 * Bulk downgrade to FREE commits `pricing_plan=FREE` for N accounts in one
 * transaction and only THEN cancels their Stripe subscriptions in the background.
 * The DB write is durable, the cancel is not — so the durable record of "this
 * subscription still has to die" must exist BEFORE the fragile work starts, not
 * be written by the fragile work itself.
 *
 * DECISION (nie usuwaj tego komentarza) — DEAD-LETTER PRZED PĘTLĄ, NIE W NIEJ:
 * wcześniej jedynym śladem po nieudanym anulowaniu był wiersz zapisywany WEWNĄTRZ
 * `cancelStripeSubscriptionIfExists`, czyli istniał wyłącznie dla userów, do których
 * pętla zdążyła dojść. Pętla leciała jako JEDEN task `runAfterResponse` (drain cap
 * 10 s przy SIGTERM), a pojedynczy cancel to ~0,3-1 s — przy batchu 100 kont ogon
 * NIE miał szansy się domknąć i redeploy go porzucał. Konto czytało się wtedy jako
 * FREE w naszej bazie, Stripe dalej obciążał kartę, a ŻADEN sweep nie mógł tego
 * znaleźć: ta sama transakcja ustawia `admin_plan_override=true`, na którym
 * syncAccountWithStripe robi early-return. Teraz wiersz reconcile powstaje w TEJ
 * SAMEJ transakcji co flip planu — commit planu ⇒ istnieje zobowiązanie do
 * anulowania, a sweep (stripe-cancel-reconcile) dociąga ogon niezależnie od tego,
 * ile zdążyła zrobić pętla.
 *
 * DECISION (nie usuwaj tego komentarza) — FLAVOR 'duplicate', NIE 'deletion':
 * flavor rozstrzyga JEDNO: co sweep robi, gdy user docelowy wciąż żyje. 'deletion'
 * ma reactivation guard („żywy user ⇒ zostaw subskrypcję") — a przy admin-downgrade
 * user ŻYJE Z ZAŁOŻENIA, więc guard rozbroiłby cały ten mechanizm: wiersz zostałby
 * zamknięty bez anulowania i ghost-billing wróciłby tylnymi drzwiami. 'duplicate' to
 * flavor „żywy user, a ta konkretna subskrypcja i tak musi zniknąć" — dokładnie nasz
 * przypadek. Koszt: alert po wyczerpaniu retry mówi o „duplicate OLD subscription",
 * choć u nas źródłem jest admin-downgrade; akcja operatora jest identyczna (anuluj
 * ręcznie w Stripe), więc nie mnożymy trzeciego flavora w module reconcile.
 * Konsekwencja tego samego guardu: wiersz, który przy porażce dopisze SAMA
 * `cancelStripeSubscriptionIfExists`, ma flavor 'deletion' i zostanie zamknięty bez
 * anulowania (user żyje) — na ścieżce admin-downgrade jest bezużyteczny, więc TEN
 * wiersz jest jedynym realnym zabezpieczeniem.
 *
 * Wiersz celuje w KONKRETNY subscription_id odczytany przy kwalifikacji, więc nigdy
 * nie zabije nowszej subskrypcji, którą stylistka założy później. Gdy pętla zdąży
 * anulować sama, wiersz zostaje otwarty, a sweep zamyka go idempotentnie na
 * odpowiedzi Stripe „already canceled" (isAlreadyCanceledCancelError).
 */

import type { Prisma } from '../../../prisma/js-client';
import {
  CANCEL_RECONCILE_EVENT_TYPE,
  buildCancelReconcileEventId,
} from '@app/stripe/cancel-reconcile/stripe-cancel-reconcile.resolver';

export type BulkCancelReconcileTarget = {
  userId: string;
  subscriptionId: string;
};

/** Powód zapisywany w `last_error` — czytany przez operatora przy triage'u. */
const BULK_DOWNGRADE_REASON =
  'Admin bulk downgrade to FREE — subscription cancel pending (enqueued with the plan write)';

/**
 * Zapisz (w AKTYWNEJ transakcji) po jednym wierszu reconcile na każde kwalifikujące
 * się konto z żywą subskrypcją. Musi być wołane WEWNĄTRZ `$transaction` razem z
 * zapisem planu — inaczej wraca dziura „plan FREE bez zobowiązania do anulowania".
 *
 * `deleteMany` + `createMany` zamiast N-krotnego `upsert` (AGENTS.md §PRISMA: zakaz
 * upsertu w pętli) — dwa statementy niezależnie od rozmiaru batcha. Kasowanie przed
 * wstawieniem odtwarza semantykę re-armingu z `enqueueSubscriptionCancelReconcile`:
 * ponowny downgrade tej samej subskrypcji dostaje świeży budżet retry zamiast trafić
 * na stary wiersz `processed`/`dead_lettered`. `skipDuplicates` domyka wyścig z
 * równoległym enqueue (P2002 wywaliłby CAŁĄ transakcję zmiany planu).
 */
export const enqueueBulkCancelReconcileRows = async (
  tx: Prisma.TransactionClient,
  targets: readonly BulkCancelReconcileTarget[]
): Promise<void> => {
  if (targets.length === 0) {
    return;
  }

  const rows = targets.map(target => ({
    event_id: buildCancelReconcileEventId({
      subscriptionId: target.subscriptionId,
      userId: target.userId,
      flavor: 'duplicate' as const,
    }),
    event_type: CANCEL_RECONCILE_EVENT_TYPE,
    last_error: BULK_DOWNGRADE_REASON,
  }));

  await tx.stripeEvent.deleteMany({
    where: { event_id: { in: rows.map(row => row.event_id) } },
  });
  await tx.stripeEvent.createMany({ data: rows, skipDuplicates: true });
};
