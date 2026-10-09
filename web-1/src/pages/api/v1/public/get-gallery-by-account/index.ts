import type { NextApiRequest } from 'next';
import { defineHandler } from '@app/http/define-handler';
import { VALIDATION_GALLERY } from '@kernel/policies/validation.config';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { respondSuccess } from '@app/http/http.responses.utils';
import { publicGetGalleryRecordsByAccount_IO } from '@domain/gallery/operations/gallery-public.operations';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { qStr, qStrArray } from '@app/http/query-params.utils';

// DECISION (nie usuwaj tego komentarza) — 2026-09-10:
// GET-owe parametry idą do req.body i przez PRAWDZIWY walidator z jądra, zamiast
// przez ręczny clamp w handlerze. Powód: `validate: () => ({__isValid: true})` plus
// clamp PRZED walidacją robiły z zadeklarowanego kontraktu fikcję — zodowe
// `min(1)`/`.int()`/`max(100)` nie pilnowały niczego (zmierzone: limit=0 → 1 rekord,
// limit=-5 → 1, limit=2.5 → 2, offset=2.5 przechodziło, limit=abc → domyślna
// strona). Clamp „ratował" Prismę, ale kosztem cichego naginania żądania do czegoś
// innego, niż klient poprosił — a przy okazji to właśnie tu mieszkało twarde
// `Math.min(..., 5)`, które unieważniało sprzedawaną drabinkę pinów 3→10→15→30→50
// (STUDIO/SCALE były NIEOSIĄGALNE ŻADNĄ ŚCIEŻKĄ). Teraz: handler tylko PRZENOSI
// query do body (mapRequest = promocja + rzutowanie typu, zero logiki biznesowej),
// jądro waliduje, a jedynym sufitem jest limit pinów z PLANU rozstrzygany w operacji
// (patrz DECISION w gallery-public.operations.ts). Wartość spoza kontraktu dostaje
// uczciwe 400 VALIDATION_FAILED zamiast po cichu podmienionej strony.
//
// Ograniczenie offsetu do `PAGINATION_CEILING` (clampOffset) NIE jest tu już
// potrzebne: schema w jądrze odrzuca offset > 10_000_000, a operacja i tak przycina
// `skip` do sufitu planu (≤ 50), więc bigintowy OFFSET Postgresa jest poza zasięgiem
// strukturalnie, nie przez clamp.
//
// Pusty parametr (`?limit=`) traktujemy jak NIEPODANY, nie jak błąd — to nie jest
// próba przekazania wartości, tylko pusty slot w query stringu (parytet z
// dotychczasowym zachowaniem qNum/qStr).
const promoteQueryParamsToBody = (req: NextApiRequest): void => {
  const rawLimit = qStr(req.query, 'limit');
  const rawOffset = qStr(req.query, 'offset');
  const accountId = qStr(req.query, 'account_id');
  const colorIds = qStrArray(req.query, 'color_ids');
  const traitIds = qStrArray(req.query, 'trait_ids');

  req.body = {
    // account_id zostaje nawet jako null — walidator ma zwrócić brak wymaganego
    // pola, a nie zobaczyć klucza usuniętego przez handler.
    account_id: accountId,
    // Number('abc') = NaN → zod odrzuca (Expected number). Świadomie NIE używamy
    // qNum, bo qNum połyka niepoprawną liczbę (zwraca null) i tym samym omija
    // kontrakt — dokładnie ta cicha ścieżka była tu błędem.
    ...(rawLimit !== null && { limit: Number(rawLimit) }),
    ...(rawOffset !== null && { offset: Number(rawOffset) }),
    ...(colorIds !== null && { color_ids: colorIds }),
    ...(traitIds !== null && { trait_ids: traitIds }),
  };
};

export default defineHandler<
  GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['REQUEST'],
  GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.GALLERY.PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT,
  method: 'get',
  mapRequest: promoteQueryParamsToBody,
  validate: VALIDATION_POLICY.validators.publicGetGalleryRecordsByAccount,
  handle: async (body, _ctx, _metadata, res, req) => {
    res.setHeader(
      'Cache-Control',
      'public, max-age=60, stale-while-revalidate=300'
    );

    // DECISION (nie usuwaj tego komentarza): `account_id` czytamy z powrotem z query,
    // a NIE z `body.account_id` — świadomie. Ratchet `audit:currentuser`
    // zabrania brania pól tożsamości z ciała żądania, a jedynym sposobem na
    // `body.account_id` byłoby wycięcie CAŁEGO tego pliku allowlistą, co zdjęłoby
    // strażnika także z przyszłych zmian w nim. Tutaj `account_id` to PODMIOT
    // publicznego odczytu (czyj profil oglądam), nie tożsamość wołającego, więc
    // strażnik jest formalnie w błędzie — ale osłabianie ratchetu dla kosmetyki jest
    // gorsze niż jeden powtórzony odczyt. Wartość jest identyczna: mapRequest przeniósł
    // dokładnie ją do body, a walidator z jądra potwierdził, że jest niepustym
    // stringiem — dlatego `?? ''` jest gałęzią nieosiągalną.
    const account_id = qStr(req.query, 'account_id') ?? '';

    // Cap DoS: filtry rozwijają się w osobny warunek per identyfikator, więc
    // koszt zapytania rośnie nieliniowo (zmierzone: 200 identyfikatorów = 7 s
    // na jedno żądanie). SSOT limitu: VALIDATION_GALLERY.MAX_FILTER_*. Przycięcie
    // (nie odrzucenie) jest świadome: to ochrona wydajnościowa, nie kontrakt —
    // schema w jądrze nie deklaruje górnej granicy długości tych tablic.
    const props = {
      account_id,
      ...(body.limit !== undefined && { limit: body.limit }),
      ...(body.offset !== undefined && { offset: body.offset }),
      ...(body.color_ids !== undefined && {
        color_ids: body.color_ids.slice(
          0,
          VALIDATION_GALLERY.MAX_FILTER_COLOR_IDS
        ),
      }),
      ...(body.trait_ids !== undefined && {
        trait_ids: body.trait_ids.slice(
          0,
          VALIDATION_GALLERY.MAX_FILTER_TRAIT_IDS
        ),
      }),
    };
    const result = await publicGetGalleryRecordsByAccount_IO({ props });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    reportIssueBackend({
      namespace: 'PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT',
      message: 'Public gallery records fetched successfully',
      payload: {
        account_id,
        returned_count: result.data.records.length,
        total_count: result.data.total_count,
      },
      mode: 'info',
    });

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.GALLERY.PUBLIC_GALLERY_RECORDS_FETCHED
    );
  },
});
