import { DB_CLIENT } from '@app/db/db.client';
import { isP2002 } from '@app/db/prisma-error';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import {
  SessionContainerLifecycleStateValue,
  VisitRecordSourceValue,
} from '@kernel/models/db_models.generated.dto';

export const createVisitRecordFromClosedSession_IO = async ({
  session_id,
}: {
  session_id: string;
}): Promise<OperationResult<{ created: boolean }, DatabaseError>> => {
  try {
    const session = await DB_CLIENT.use.sessionContainer.findUnique({
      where: { id: session_id },
      select: {
        id: true,
        lifecycle_state: true,
        shared_at: true,
        closed_at: true,
        stylist_account_id: true,
        client_account: { select: { created_by_user_id: true } },
      },
    });

    if (
      !session ||
      session.lifecycle_state !== SessionContainerLifecycleStateValue.CLOSED ||
      session.shared_at === null ||
      session.stylist_account_id === null
    ) {
      return success({ created: false });
    }

    // DECISION (nie usuwaj tego komentarza):
    // Sufit wizyt na parę obowiązuje OBIE ścieżki wstawiania, nie tylko ręczną.
    // Wcześniej `createManualVisit_IO` pilnowało `MAX_VISITS_PER_PAIR`, a ta —
    // druga, automatyczna — ścieżka nie pilnowała niczego, więc bariera przed
    // pętlą (zbugowany klient/skrypt zamykający sesje) była do obejścia bokiem.
    // Liczymy BEZ locka i BEZ transakcji, świadomie: ta operacja bywa wołana
    // także przy zrywaniu pary (`revokePairingAccess_IO`), kiedy aktywnej pary
    // już NIE MA, więc lock na wierszu pary — którym serializuje się ścieżka
    // ręczna — jest tu niedostępny. Skutkiem jest cap miękki: równoległe
    // archiwizacje mogą przekroczyć sufit o kilka wierszy. To wystarcza, bo
    // sufit jest barierą przed nieskończoną pętlą, a nie regulatorem produktu
    // (2000 wizyt = ~40 lat wizyt co tydzień), a duplikaty tej samej sesji
    // odcina i tak `@@unique(session_id)` (gałąź P2002 niżej).
    const visitCount = await DB_CLIENT.use.visitRecord.count({
      where: {
        client_user_id: session.client_account.created_by_user_id,
        stylist_account_id: session.stylist_account_id,
      },
    });
    if (visitCount >= VISIT_CONFIG.MAX_VISITS_PER_PAIR) {
      // Cichy `created:false` ukryłby fakt, że historia klientki przestała
      // rosnąć. Ścieżka jest best-effort, więc nie blokujemy zamknięcia sesji —
      // ale zostawiamy ślad, bo dobicie do sufitu to sygnał do przemyślenia
      // modelu (archiwizacja starych wizyt), nie normalny stan.
      reportIssueBackend({
        namespace: 'session-visit-archive',
        message: `Visit cap reached for pair — closed session not archived: ${session_id}`,
        payload: {
          visitCount,
          limit: VISIT_CONFIG.MAX_VISITS_PER_PAIR,
          stylistAccountId: session.stylist_account_id,
        },
        mode: 'warn',
      });
      return success({ created: false });
    }

    await DB_CLIENT.use.visitRecord.create({
      data: {
        client_user_id: session.client_account.created_by_user_id,
        stylist_account_id: session.stylist_account_id,
        visit_date: session.closed_at ?? new Date(),
        source: VisitRecordSourceValue.SESSION,
        session_id: session.id,
      },
    });

    return success({ created: true });
  } catch (error) {
    if (isP2002(error)) {
      return success({ created: false });
    }
    return databaseFailure('createVisitRecordFromClosedSession_IO', error);
  }
};

export const scheduleSessionVisitArchiveBestEffort = ({
  session_id,
}: {
  session_id: string;
}): void => {
  // DECISION (nie usuwaj tego komentarza):
  // `runAfterResponse`, nie goła floating-promise. Gołe `void` żyje poza rejestrem
  // efektów, więc graceful shutdown (każdy redeploy) NIE czeka na jego dokończenie —
  // sesja zamknięta tuż przed restartem nie doczekała się wpisu wizyty i nic tego
  // nie wykrywało, bo operacja jest best-effort i cicha z założenia. Opakowanie
  // niczego nie spowalnia (efekt i tak leci po odpowiedzi), za to dołącza go do
  // drenażu przy zamykaniu procesu.
  runAfterResponse(() =>
    createVisitRecordFromClosedSession_IO({ session_id })
      .then(result => {
        if (!result.success) {
          reportIssueBackend({
            namespace: 'session-visit-archive',
            message: `Could not archive closed session as visit: ${session_id}`,
            payload: { errorType: result.error.type },
            mode: 'warn',
          });
        }
      })
      .catch(error => {
        reportIssueBackend({
          namespace: 'session-visit-archive',
          message: `Unexpected archive failure for closed session: ${session_id}`,
          // Raw Error serializuje do {} (message/stack są non-enumerable) → payload
          // pusty w telemetrii. Wyciągamy message jawnie, spójnie z gałęzią .then.
          payload: {
            error: error instanceof Error ? error.message : String(error),
          },
          mode: 'warn',
        });
      })
  );
};
