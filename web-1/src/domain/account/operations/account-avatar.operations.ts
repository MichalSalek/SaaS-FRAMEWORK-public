// account-avatar.operations.ts
// Zdjęcie profilowe stylistki: ustawienie wgranego pliku i powrót do fallbacku.
//
// DECISION (nie usuwaj tego komentarza) — decyzja ownera 2026-09-09
// („dowozimy upload avatara, cover zostaje generatywny"):
// Kolumna `stylist_account.avatar_url` PRZESTAŁA być rusztowaniem — to jest jej
// jedyna ścieżka zapisu. Okładka profilu (pas nad wizytówką) ZOSTAJE generatywna
// (`brand_accent_color` → `coverHueVars`) i nie ma tu ani kolumny, ani uploadu.
//
// SECURITY: `account_id` bierze się z sesji (requireStylistAccount na granicy
// handlera), nigdy z ciała żądania — klasa IDOR.

import { casUpdate } from '@app/db/cas';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { findForeignAssetOwner } from '@domain/_shared/guards/cloudinary-asset.guard';
import { cleanupCloudinaryAsset } from '@domain/gallery/operations/gallery-cloudinary-cleanup';
import type { IDType } from '@kernel/application/application.types';
import type {
  AccountNotFoundError,
  DatabaseError,
  SerializationConflictError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type { OperationResult } from '@kernel/application/result.types';
import { failure, success } from '@kernel/application/result.types';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { extractPublicIdFromUrl } from '@app/cloudinary/cloudinary-url.utils';

type Response = ACCOUNT_DTO_API_V1['ACCOUNT_SET_AVATAR']['RESPONSE'];

export const accountSetAvatar_IO = async ({
  account_id,
  avatar_url,
}: {
  account_id: IDType;
  avatar_url: string | null;
}): Promise<
  OperationResult<
    Response,
    | AccountNotFoundError
    | ValidationError
    | DatabaseError
    | SerializationConflictError
  >
> => {
  const accountId = String(account_id);

  // DECISION (nie usuwaj tego komentarza):
  // Adres pliku przychodzi OD KLIENTA (upload leci z przeglądarki wprost do
  // chmury), a walidator kernela potwierdza tylko, że wskazuje na
  // nasz CDN. To za mało: z adresu liczy się `public_id`, którym kasuje się plik,
  // więc bez tej bramki dało się ustawić sobie CUDZE zdjęcie jako avatar (kradzież
  // wizerunku na publicznym profilu), a przy następnej podmianie skasować cudzy
  // plik z chmury. Ta sama bramka co przy zdjęciach efektu wizyty — jedna
  // implementacja, `_shared/guards/cloudinary-asset.guard`.
  if (avatar_url !== null) {
    const ownership = await findForeignAssetOwner(avatar_url, accountId);
    if (ownership !== 'OWN') {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'avatar_url',
        message:
          ownership === 'FOREIGN'
            ? 'Avatar URL belongs to another account'
            : 'Avatar URL is not a recognized Cloudinary upload address',
      });
    }
  }

  // DECISION (nie usuwaj tego komentarza) — ZAPIS WARUNKOWY, NIE „odczytaj i nadpisz":
  // wartość, którą zapis WYPARŁ, jest wejściem do nieodwracalnego kasowania pliku w
  // chmurze, więc musi pochodzić z WYNIKU zapisu, a nie z wcześniejszego odczytu.
  // Przy zwykłym odczyt-potem-zapis (nawet w transakcji, bo domyślny poziom izolacji
  // to Read Committed) dwa równoległe żądania na to samo konto czytają tę samą starą
  // wartość, oba zapisują swoją i oba uznają, że wyparły starą — plik przegranego
  // zapisu nie jest przez nikogo wskazany ani nikomu znany, więc zostaje w chmurze na
  // zawsze. Bramka `avatar_url: current.avatar_url` w WHERE robi z warunku część
  // zapisu (prymityw `casUpdate`, ten sam, którym epik hardeningu bazy zastąpił tę
  // klasę błędów). `count === 0` = ktoś nas wyprzedził → czytamy na nowo i próbujemy
  // ponownie; wygrywa ostatni zapis, ale KAŻDY zna wartość, którą realnie wyparł.
  const MAX_CAS_ATTEMPTS = 3;
  let result: { account: Response; previousAvatarUrl: string | null } | null =
    null;

  try {
    for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS && !result; attempt++) {
      const current = await DB_CLIENT.use.stylistAccount.findUnique({
        where: { account_id: accountId },
        select: { avatar_url: true },
      });
      if (!current) {
        return failure({ type: 'ACCOUNT_NOT_FOUND', accountId });
      }

      if (current.avatar_url === avatar_url) {
        // Ta sama wartość = brak zapisu i, co ważniejsze, brak sprzątania:
        // „poprzedni" byłby wtedy adresem ŻYWEGO avatara i skasowałby go z chmury.
        result = {
          account: { account_id: accountId, avatar_url },
          previousAvatarUrl: null,
        };
        break;
      }

      const changed = await casUpdate(() =>
        DB_CLIENT.use.stylistAccount.updateMany({
          where: { account_id: accountId, avatar_url: current.avatar_url },
          // `avatar_public_id` idzie RAZEM z adresem, w tym samym zapisie CAS — inaczej
          // dałoby się rozjechać kolumnę identyfikatora z kolumną adresu, a bramka
          // własności pliku pyta o tę pierwszą. `null` (adres nierozkładalny albo
          // wyczyszczenie avatara) zostawia wiersz na wolniejszej ścieżce porównania.
          data: {
            avatar_url,
            avatar_public_id:
              avatar_url === null ? null : extractPublicIdFromUrl(avatar_url),
          },
        })
      );

      if (changed > 0) {
        result = {
          account: { account_id: accountId, avatar_url },
          previousAvatarUrl: current.avatar_url,
        };
      }
      // changed === 0 → wartość zmieniła się między odczytem a zapisem; kolejny
      // obrót pętli czyta świeży stan. Wiersz skasowany w międzyczasie wyjdzie
      // jako ACCOUNT_NOT_FOUND przy następnym odczycie.
    }
  } catch (error: unknown) {
    return databaseFailure('accountSetAvatar_IO', error);
  }

  if (!result) {
    // DECISION (nie usuwaj tego komentarza) — WYCZERPANY BUDŻET CAS TO KONFLIKT (429), NIE AWARIA (500):
    // przerwanie pętli ZOSTAJE (zapis z nieznaną wartością wypartą = po cichu porzucony
    // plik w chmurze), ale werdykt idzie kanałem retryable. Zmierzone: 8 równoległych
    // POST-ów dało 4×200 i 4×500 GENERAL_ERROR — końcowa wartość poprawna, żaden plik nie
    // osierocony, czyli NIC się nie zepsuło, a mimo to zwykła rywalizacja wywołana przez
    // użytkowniczkę (dwuklik, wznowiony upload) meldowała się w logach jako DATABASE_ERROR
    // i psuła triaż błędów. Świadomie NIE podnosimy budżetu: pętla read-then-CAS przy
    // dowolnym stopniu współbieżności nie ma budżetu, który gwarantuje wygraną (to livelock,
    // nie deterministyczny limit), więc większa liczba prób tylko przesuwa próg i wydłuża
    // ogon opóźnień, a błędny kod odpowiedzi kłamie tak samo przy 3, jak przy 30 próbach.
    // Trzy próby trzymają ogon krótki, a przegrany dostaje uczciwe „ponów" — ten sam kanał,
    // którym idzie przegrany Serializable (40001 → 429, patrz error-mapper SERIALIZATION_CONFLICT
    // i `isSerializationConflict`); tu konflikt wykrywa CAS zamiast Postgresa, ale semantyka
    // dla klienta jest identyczna.
    return failure({ type: 'SERIALIZATION_CONFLICT' });
  }

  // Sprzątanie PO zapisie: dopóki wiersz nie wskazuje na nowy adres, stary adres
  // jest wciąż „w użyciu" i bramka referencyjna sinku odmówiłaby kasowania.
  // Fire-and-forget z własnym retry/backoffem — osierocony plik nie może wywrócić
  // zapisu profilu.
  if (result.previousAvatarUrl !== null) {
    cleanupCloudinaryAsset(result.previousAvatarUrl);
  }

  return success(result.account);
};

// Zbiera adres avatara konta stylistki PRZED terminalnym usunięciem użytkownika.
// Odkąd kolumna ma ścieżkę zapisu (2026-09-09), kasowanie konta bez tego kroku
// zostawiałoby w chmurze zdjęcie twarzy — a to akurat ten rodzaj pliku, którego
// „i tak zniknie z bazy" nie usprawiedliwia (RODO art. 17). Best-effort: błąd
// zwraca pustą listę, bo sprzątanie jest fire-and-forget i NIE może zablokować
// usunięcia konta (parytet z collectVisitResultPhotoUrlsForUser_IO).
export const collectStylistAvatarUrlsForUser_IO = async (
  userId: string
): Promise<string[]> => {
  try {
    const accounts = await DB_CLIENT.use.stylistAccount.findMany({
      where: { created_by_user_id: userId, avatar_url: { not: null } },
      select: { avatar_url: true },
    });
    return accounts
      .map(account => account.avatar_url)
      .filter((url): url is string => url !== null);
  } catch (error) {
    reportIssueBackend({
      namespace: 'account-avatar-cleanup',
      message: `Could not collect stylist avatar URL before account delete: ${userId}`,
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'warn',
    });
    return [];
  }
};
