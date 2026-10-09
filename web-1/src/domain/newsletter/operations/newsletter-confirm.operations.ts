import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { NewsletterInvalidTokenError } from '@kernel/domain/newsletter/newsletter-errors.types';
import { NEWSLETTER_CONSENT_ACTION } from '@kernel/domain/newsletter/newsletter-consent.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { addConfirmedSubscriberToAudience } from '@app/email-handler/newsletter-audience';
import { runAfterResponse } from '@app/runtime/run-after-response';

type NewsletterConfirmSuccess = {
  confirmed: true;
  already_confirmed?: boolean;
};

type NewsletterConsentClientInfo = {
  ipAddress?: string;
  userAgent?: string;
};

export const newsletterConfirm_IO = async (
  confirmationToken: string,
  clientInfo: NewsletterConsentClientInfo = {}
): Promise<
  OperationResult<
    NewsletterConfirmSuccess,
    NewsletterInvalidTokenError | DatabaseError
  >
> => {
  // Look up subscriber by token first. After confirmation we null the token,
  // so a confirmed subscriber will not be found here — for idempotency on a second
  // click of the same link we accept the loss and return INVALID_TOKEN (which is
  // truthful: token has been consumed).
  let subscriber: {
    id: string;
    email: string;
    is_active: boolean;
    confirmed_at: Date | null;
  } | null;
  try {
    subscriber = await DB_CLIENT.use.newsletterSubscriber.findUnique({
      where: { confirmation_token: confirmationToken },
      select: {
        id: true,
        // email needed to sync the confirmed contact into the Resend broadcast
        // audience (double opt-in confirmed = valid consent to receive sends).
        email: true,
        is_active: true,
        confirmed_at: true,
      },
    });
  } catch (error) {
    return databaseFailure('newsletterConfirm_IO.findUnique', error);
  }

  if (!subscriber) {
    return failure({ type: 'NEWSLETTER_INVALID_TOKEN' });
  }

  // Defensive idempotency: if somehow the same token still maps to an already
  // confirmed subscriber (e.g. a partial write), treat as already-confirmed.
  if (subscriber.is_active && subscriber.confirmed_at) {
    return success({ confirmed: true, already_confirmed: true });
  }

  const now = new Date();

  // DECISION (nie usuwaj tego komentarza) — CAS (KROK 2 LOW): dwa rownoczesne kliki tego samego
  // linku potwierdzajacego trafialy oba w findUnique (token jeszcze obecny) -> oba szly do update.
  // Goly update({where:{id}}) wykonywal sie u OBU (idempotentne wartosci), ale OBA tworzyly
  // newsletterConsentEvent SUBSCRIBE -> DUPLIKAT zdarzenia zgody (RODO Art.7 audit-trail liczy 2
  // zgody na 1 potwierdzenie). Fix: updateMany z guardem `confirmation_token = token` (CAS — token
  // wciaz obecny W CZASIE ZAPISU); count===0 => inny writer skonsumowal token miedzy read a write
  // => zwracamy idempotentne already_confirmed i NIE tworzymy drugiego consent-eventu. Consent-event
  // powstaje TYLKO gdy ten wlasnie zapis faktycznie potwierdzil subskrypcje (count===1). Interactive
  // tx (NIE array-form) by warunkowo pominac event na podstawie count.
  let didConfirm: boolean;
  try {
    didConfirm = await DB_CLIENT.use.$transaction(async tx => {
      const updated = await tx.newsletterSubscriber.updateMany({
        where: { id: subscriber.id, confirmation_token: confirmationToken },
        data: {
          is_active: true,
          confirmation_token: null,
          confirmed_at: now,
          consent_timestamp: now,
        },
      });

      if (updated.count === 0) {
        return false; // concurrent confirm won the token — no duplicate consent event
      }

      await tx.newsletterConsentEvent.create({
        data: {
          newsletter_id: subscriber.id,
          action: NEWSLETTER_CONSENT_ACTION.SUBSCRIBE,
          consent_timestamp: now,
          // RODO Art. 7(1) accountability — record the consent context.
          ...(clientInfo.ipAddress !== undefined
            ? { ip_address: clientInfo.ipAddress }
            : {}),
          ...(clientInfo.userAgent !== undefined
            ? { user_agent: clientInfo.userAgent }
            : {}),
        },
      });
      return true;
    });
  } catch (error) {
    return databaseFailure('newsletterConfirm_IO.update', error);
  }

  if (!didConfirm) {
    // Concurrent confirm won the token — the other writer already synced (or will).
    return success({ confirmed: true, already_confirmed: true });
  }

  // Genuine double opt-in confirmation → sync the contact into the Resend broadcast
  // audience. Deferred via runAfterResponse (NOT awaited): consent is already
  // committed to the DB (SSOT), and the sync is best-effort/never-throws — awaiting
  // it here would block the confirm-link HTTP response by up to the Resend request
  // time (8s worst case) for zero user benefit. Non-Vercel (Render) → floating
  // promise completes in the background; same pattern as email-unsubscribe.
  runAfterResponse(() => addConfirmedSubscriberToAudience(subscriber.email));

  return success({ confirmed: true });
};
