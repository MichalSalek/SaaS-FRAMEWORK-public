import { readSubscriptionBilling_IO } from '@app/stripe/subscription-billing.operations';
import { defineEndpoint } from '@app/http/define-endpoint';
import { SESSION_CONTRACTS } from '@kernel/domain/session/session.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { toSafeCurrentUser } from '@domain/user/user.utils.api';
export default defineEndpoint(SESSION_CONTRACTS.SESSION_GET_CURRENT, {
  handle: async ({ ctx: { currentUser, session }, ok }) => {
    // DECISION: get-current is a hot polling endpoint (hit on every navigation/session refresh), so the
    // e-mail (PII) is NOT logged on each call; id + session_id suffice for diagnostics. An e-mail in the
    // info log on this path is a needless, repeated PII leak into the Event Log Store.
    reportIssueBackend({
      namespace: 'SESSION_GET_CURRENT',
      message:
        currentUser != null
          ? 'Session check: active'
          : 'Session check: no active session',
      payload:
        currentUser != null
          ? { id: currentUser.id, session_id: session?.id }
          : null,
      mode: 'info',
    });

    // Jeden sanitizer dla każdej odpowiedzi z CurrentUser (token sesji, relacje
    // spoza kontraktu, allowlista `stylist_account`) — inline destructure tutaj
    // przepuszczał cały wiersz StylistAccount razem z polami billingowymi.
    const safeData =
      currentUser != null ? toSafeCurrentUser(currentUser) : undefined;

    if (
      safeData?.stylist_account != null &&
      currentUser?.stylist_account != null &&
      currentUser.account_type === 'STYLIST'
    ) {
      safeData.stylist_account.billing = await readSubscriptionBilling_IO(
        currentUser.stylist_account.subscription_id,
        currentUser.stylist_account.account_id
      );
    }

    ok(safeData, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
