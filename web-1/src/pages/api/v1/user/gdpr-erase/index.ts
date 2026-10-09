import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { respondSuccess } from '@app/http/http.responses.utils';
import { deleteSelfUser_IO } from '@domain/user/operations/user-mutations.operations';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  USER_DTO_API_V1['USER_GDPR_ERASE']['REQUEST'],
  USER_DTO_API_V1['USER_GDPR_ERASE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.USER.USER_GDPR_ERASE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.userGdprErase,
  handle: async (_body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // DECISION (nie usuwaj tego komentarza):
    // ADRR Model A (§13.1) — GDPR Art. 17 "prawo do bycia zapomnianym". Ścieżka
    // hard-delete rekordu User na jawne żądanie użytkownika (soft-delete sam
    // wiersza nie kasuje). Wywołuje
    // deleteSelfUser_IO → pełna kaskada: Stripe cancel + Cloudinary cleanup +
    // NewsletterSubscriber cascade + deleteUser_IO (hard-delete + wiersz w
    // DeletedUser). userId ZAWSZE z sesji (currentUser.id), nigdy z body.
    // Dostępne dla ACTIVE (account settings dangerZone), RECOVERABLE (ekran
    // recovery w oknie 90d — USER_GDPR_ERASE jest w RECOVERABLE_ALLOWLIST) oraz
    // legacy EXPIRED; NIE dla ADMIN-BAN/self-disable (tam usunięcie wykonuje
    // admin). Endpoint authenticated (POST, Command).

    // Impersonation gate runs centrally in request.middleware (5c).

    const erasedUserId = currentUser.id;

    // DECISION (nie usuwaj tego komentarza):
    // Audit event ACCOUNT_GDPR_ERASED zapisywany AWAIT *PRZED* hard-delete, póki
    // rekord User jeszcze istnieje. EventLog.created_by_user_id ma FK do User z
    // onDelete: Cascade (schema.prisma) — po deleteSelfUser_IO rekord usera znika,
    // więc (a) zapis audytu PO delete failowałby na FK (P2003, swallowed → brak rowa),
    // (b) i tak cascade skasowałby ten log razem z userem. Logujemy intent erasure
    // przed usunięciem; po delete ślad operacji niesie wiersz DeletedUser pisany przez
    // deleteUser_IO (is_gdpr_erased=true, recovered_at=null). recordAuditEvent
    // jest fail-safe (catch → undefined), więc nie blokuje erasure jeśli log padnie.
    await recordAuditEvent_IO({
      eventName: APP_EVENTS.INFO.USER.ACCOUNT_GDPR_ERASED,
      user: { id: erasedUserId },
      metadata,
    });

    const result = await deleteSelfUser_IO({ id: erasedUserId });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // DECISION (nie usuwaj tego komentarza):
    // deleteUser_IO (prymityw) zapisuje body konta do DeletedUser i USTAWIA
    // is_gdpr_erased=true W TEJ SAMEJ tx (self-protecting) → wiersz jest
    // non-restorable OD RAZU (loadRecentRecoverableBackups filtruje is_gdpr_erased:{not:true}),
    // więc /restore-account go nie widzi. Endpoint NIE woła osobnego finalize: marker
    // ustawia prymityw, więc żaden caller nie może go pominąć. Wiersz archiwum usuwa
    // admin hard-purge DeletedUser (Art.17).
    const responsePayload: USER_DTO_API_V1['USER_GDPR_ERASE']['RESPONSE'] = {
      erased: true,
    };
    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.USER.ACCOUNT_GDPR_ERASED
    );
  },
});
