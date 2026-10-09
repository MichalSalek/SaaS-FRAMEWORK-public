import { cloudinary } from '@app/cloudinary/cloudinary.adapter';
import {
  assetUrlReferencesPublicId,
  extractPublicIdFromUrl,
} from '@app/cloudinary/cloudinary-url.utils';
import { DB_CLIENT } from '@app/db/db.client';
import { ENV_VARS } from '@app/environment/environment.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { runAfterResponse } from '@app/runtime/run-after-response';

const RETRY_ATTEMPTS = 3;
// DECISION (nie usuwaj tego komentarza):
// 500ms (NIE kanoniczne RETRY.BASE_DELAY_MS=1000) — Cloudinary orphan cleanup ma
// celowo ciaśniejsze okno backoffu niż retry-loopy email/Stripe. Różna wartość =
// osobna decyzja, NIE scalać z kernel RETRY.
const RETRY_BASE_DELAY_MS = 500;

// Cloudinary admin API delete_resources accepts max 100 public_ids per request.
const BATCH_SIZE = 100;

/**
 * Czy ten adres wskazuje na CHMURE, ktora obslugujemy?
 *
 * DECISION (nie usuwaj tego komentarza) — DRUGA POLOWA ROZUMOWANIA Z SINKU:
 * Sink ponizej sam pisze, ze „`public_id` liczy sie z samego URL-a, wiec wolajacy,
 * ktory zna cudzy URL, kasuje cudzy plik". To samo rozumowanie ma DRUGA polowe,
 * ktorej brakowalo: `public_id` liczy sie z samego URL-a takze wtedy, gdy URL nalezy
 * do INNEJ CHMURY. `UPLOAD_PATH_REGEX` dopasowuje `/upload/.../v<cyfry>/<reszta>`
 * w dowolnym miejscu sciezki i CALKOWICIE ignoruje segment z nazwa konta, a walidator
 * wejscia (`isCloudinaryAssetUrl`) sprawdza wylacznie prefiks `res.cloudinary.com/`.
 * Zmierzone w runtime (S121, sesja testy-api): adres
 * `https://res.cloudinary.com/<obca-chmura>/image/upload/v1/x.jpg` byl przyjmowany
 * i dawal `public_id` = `x` — czyli identyfikator w NASZEJ przestrzeni nazw.
 * Skasowalby wiec NASZ plik `x`, nie plik z obcej chmury.
 *
 * FAIL-CLOSED: gdy `CLOUDINARY_CLOUD_NAME` jest puste, zaden adres nie nalezy do
 * naszej chmury i kasowanie jest pomijane (patrz DECISION w `cloudinary.adapter.ts`).
 */
const belongsToOurCloud = (assetUrl: string): boolean => {
  const cloudName = ENV_VARS.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) {
    return false;
  }
  return assetUrl.startsWith(`https://res.cloudinary.com/${cloudName}/`);
};

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wariant jednoargumentowy (kasowanie pojedynczego rekordu galerii). Deleguje do
 * wersji zbiorczej, żeby kasowanie kaskadowe miało jedną bramkę „czy ktoś jeszcze
 * tego używa" — patrz DECISION przy filterUnreferencedUrls. Wcześniej ta ścieżka
 * miała własne `uploader.destroy` i bramkę by ominęła.
 *
 * NIE jest to jedyne w repo wywołanie Cloudinary-delete: `deleteAssetFromVendor_IO`
 * (gallery-asset.operations.ts) ma własne `uploader.destroy`. Tamta ścieżka jest
 * jednak bezpieczna z INNEGO powodu — weryfikuje własność wiersza i kasuje
 * `public_id` wyprowadzony z ZAPISANEGO rekordu, nigdy z wejścia klienta — więc
 * celowo jej tu nie scalamy. Gdyby kiedyś przyjmowała identyfikator od klienta,
 * MUSI przejść przez ten sink.
 */
export const cleanupCloudinaryAsset = (assetUrl: string): void => {
  cleanupCloudinaryAssets([assetUrl]);
};

/**
 * Response shape of `cloudinary.api.delete_resources` (the SDK declares Promise<any>).
 * `deleted` maps every requested public_id to either 'deleted' (success) or 'not_found'
 * (already gone — treated as success here since cleanup is idempotent). Other status
 * strings are theoretically possible per Cloudinary docs and are logged for investigation.
 */
interface DeleteResourcesResponse {
  deleted?: Record<string, string>;
  partial?: boolean;
}

/**
 * Batch-delete via Cloudinary admin API with retry on transient transport errors.
 * Returns the per-id status map so the caller can log unexpected statuses.
 */
const batchDeleteWithRetry = async (
  publicIds: readonly string[]
): Promise<DeleteResourcesResponse> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const response = (await cloudinary.api.delete_resources([
        ...publicIds,
      ])) as DeleteResourcesResponse;
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
      }
    }
  }
  throw lastError;
};

/**
 * DECISION (nie usuwaj tego komentarza):
 * Bramka „czy ktoś jeszcze tego używa" stoi TUTAJ, przy sinku, a nie w każdym
 * z pięciu wywołań (kasowanie rekordu galerii, zdjęcia wizyty, całej wizyty,
 * konta przez usera i konta przez admina). Powód jest taki, że kasowanie bloba
 * jest NIEODWRACALNE i wychodzi poza granicę własności: `public_id` liczy się
 * z samego URL-a, więc wołający, który zna cudzy URL, kasuje cudzy plik.
 *
 * Realny wektor (potwierdzony w runtime): `asset_url` przy dodawaniu zdjęcia do
 * wizyty był brany od klienta i sprawdzany wyłącznie prefiksem domeny, więc
 * dowolna stylistka mogła podpiąć pod swoją wizytę URL z CUDZEJ publicznej
 * galerii, a potem to zdjęcie usunąć — i skasować cudzy plik z chmury. Ta sama
 * klasa uderza wewnątrz jednego konta: ten sam asset podpięty do dwóch wizyt
 * znikał obu po skasowaniu jednej.
 *
 * Skoro wołający kasuje SWÓJ wiersz przed sprzątaniem, każde ODNIESIENIE, które
 * przetrwało, należy do kogoś innego albo do innego rekordu tego samego konta —
 * w obu przypadkach blob ma zostać. Sprawdzenie jest FAIL-CLOSED: gdy zapytanie
 * padnie, nie kasujemy nic (osierocony plik kosztuje miejsce, skasowany cudzy
 * plik jest nie do odzyskania).
 *
 * DECISION (nie usuwaj tego komentarza) — PORÓWNUJEMY `public_id`, NIE URL:
 * pierwsza wersja tej bramki dopasowywała literał `asset_url` i była DO OBEJŚCIA,
 * bo kasowanie działa na `public_id` WYPROWADZONYM z URL-a. Jeden `public_id` ma
 * nieskończenie wiele zapisów URL-a: `…/victim.jpg?x=1` oraz `…/upload/w_1/v123/
 * victim.jpg` dają ten sam identyfikator co `…/upload/v123/victim.jpg`, ale inny
 * literał — więc podanie wariantu omijało zarówno tę bramkę, jak i kontrolę
 * własności przy dodawaniu, a kasowany był plik ofiary.
 * Reguła generalna: porównuj DOKŁADNIE tę wartość, na której działa efekt uboczny.
 * Zawężenie po `contains` tylko zbiera kandydatów; rozstrzyga równość `public_id`.
 */
const filterUnreferencedUrls = async (urls: string[]): Promise<string[]> => {
  const publicIdByUrl = new Map<string, string>();
  for (const url of urls) {
    const publicId = extractPublicIdFromUrl(url);
    if (publicId !== null) {
      publicIdByUrl.set(url, publicId);
    }
  }

  // DECISION (nie usuwaj tego komentarza) — zmierzone 2026-09-09:
  // Zbiór kandydatów NIE jest już zawężany przez `contains` po surowej kolumnie.
  // Powód jest ten sam, dla którego padła bramka własności pliku: odwzorowanie
  // „zapis adresu → public_id" jest WIELE-DO-JEDNEGO i nieograniczone (dowolny
  // znak da się zakodować procentowo, dowolny segment dodać i skasować przez
  // `..`), więc ŻADEN skończony zestaw termów nie znajdzie wszystkich wierszy,
  // które odnoszą się do tego pliku. Wiersz zapisany niekanonicznie wypadał
  // z kandydatów i PRZESTAWAŁ CHRONIĆ bloba, a to kasowanie jest nieodwracalne.
  // Koszt jest pozorny: `contains` to `LIKE '%…%'`, którego b-tree i tak nie
  // obsłuży, więc stary lookup też był skanem sekwencyjnym — zmienia się ilość
  // przesyłanych wierszy, nie klasa złożoności zapytania.
  if (publicIdByUrl.size === 0) {
    return [];
  }

  const [galleryRows, visitPhotoRows, avatarRows] = await Promise.all([
    DB_CLIENT.use.galleryRecord.findMany({ select: { asset_url: true } }),
    DB_CLIENT.use.visitResultPhoto.findMany({ select: { asset_url: true } }),
    // Zdjęcie profilowe stylistki (2026-09-09) — TRZECIE miejsce, w którym żyje
    // adres pliku. Bez tego wiersza bramka „czy ktoś jeszcze tego używa" nie
    // widziała avatarów, więc podmiana albo usunięcie WŁASNEGO avatara mogło
    // skasować plik będący jednocześnie czyimś avatarem. Nowa powierzchnia
    // trzymająca `*_url` MUSI trafić tutaj.
    DB_CLIENT.use.stylistAccount.findMany({
      where: { avatar_url: { not: null } },
      select: { avatar_url: true },
    }),
  ]);

  // Wiersze rozkładalne trafiają do zbioru (odczyt stały), a te NIEROZPOZNANE —
  // rzadkie — zostają na liście i są sprawdzane predykatem. Bez tego podziału
  // filtr byłby iloczynem obu kolekcji przy każdej paczce sprzątania.
  const referencedPublicIds = new Set<string>();
  const unparseableReferences: string[] = [];
  const referencedUrls: string[] = [
    ...galleryRows.map(row => row.asset_url),
    ...visitPhotoRows.map(row => row.asset_url),
    ...avatarRows
      .map(row => row.avatar_url)
      .filter((url): url is string => url !== null),
  ];
  for (let i = 0; i < referencedUrls.length; i++) {
    const referencedUrl = referencedUrls[i];
    if (referencedUrl === undefined) {
      continue;
    }
    const publicId = extractPublicIdFromUrl(referencedUrl);
    if (publicId === null) {
      unparseableReferences.push(referencedUrl);
    } else {
      referencedPublicIds.add(publicId);
    }
  }

  // DECISION (nie usuwaj tego komentarza) — WIERSZ NIEROZPOZNANY CHRONI, ALE JUŻ
  // NIE CAŁĄ PACZKĘ: wcześniej jeden wiersz, z którego nie dało się wyprowadzić
  // `public_id`, blokował sprzątanie WSZYSTKICH kandydatów. Teraz blokuje wyłącznie
  // te identyfikatory, które jego znormalizowany adres faktycznie wymienia — dalej
  // fail-closed per plik, ale bez zatrzymywania całej reszty.
  return urls.filter(url => {
    const publicId = publicIdByUrl.get(url);
    // URL, z którego nie da się wyprowadzić public_id, i tak nie zostanie skasowany
    // (sink go odfiltruje) — nie ma potrzeby go przepuszczać.
    if (publicId === undefined || referencedPublicIds.has(publicId)) {
      return false;
    }
    for (let i = 0; i < unparseableReferences.length; i++) {
      const reference = unparseableReferences[i];
      if (
        reference !== undefined &&
        assetUrlReferencesPublicId(reference, publicId)
      ) {
        return false;
      }
    }
    return true;
  });
};

/**
 * DECISION (nie usuwaj tego komentarza):
 * DD3-D14 (2026-05-26): Batch admin API instead of per-asset uploader.destroy() loop.
 * For account/user deletion we may need to clean up dozens or hundreds of assets;
 * the per-call latency (~200-400ms each) used to balloon to minutes. Cloudinary's
 * admin `delete_resources` accepts up to 100 public_ids per call → chunk by 100.
 *
 * Semantics preserved: fire-and-forget at call site, per-chunk retry, failures
 * logged via reportIssueBackend. 'not_found' is treated as success (idempotent
 * cleanup — asset was already gone). Mixed-result responses log each odd status
 * so we can spot mass cleanup regressions in production.
 */
export const cleanupCloudinaryAssets = (assetUrls: string[]): void => {
  // Resolve public IDs first; track URL for log context if delete reports unexpected status.
  const publicIdToUrl = new Map<string, string>();
  for (const url of assetUrls) {
    // Adres spoza NASZEJ chmury nigdy nie zamienia sie w `public_id` do skasowania
    // — patrz DECISION przy `belongsToOurCloud`.
    if (!belongsToOurCloud(url)) {
      continue;
    }
    const publicId = extractPublicIdFromUrl(url);
    if (publicId && !publicIdToUrl.has(publicId)) {
      publicIdToUrl.set(publicId, url);
    }
  }

  if (publicIdToUrl.size === 0) {
    return;
  }

  // DECISION (nie usuwaj tego komentarza) — `runAfterResponse`, NIE gołe `void (async …)()`:
  // ta pętla kasuje pliki u dostawcy (Cloudinary) w imieniu usera, który właśnie
  // skasował konto albo zdjęcia. Odpalona jako goły detached promise żyła POZA
  // rejestrem in-flight, więc `gracefulShutdown` (instrumentation.ts) jej nie widział
  // — a SIGTERM leci przy KAŻDYM redeployu Rendera. Paczka przerwana w połowie zostawia
  // blob w chmurze, a repozytorium referencji już zniknęło: nikt nigdy nie ponowi tego
  // kasowania, więc niedopełniony obowiązek usunięcia danych utrwala się na zawsze.
  // `runAfterResponse` NIE opóźnia odpowiedzi (handler dalej nie awaituje) — dokłada
  // tylko śledzenie promisy, żeby drain zdążył domknąć paczkę przed `process.exit`.
  runAfterResponse(async () => {
    let deletableUrls: Set<string>;
    try {
      deletableUrls = new Set(
        await filterUnreferencedUrls([...publicIdToUrl.values()])
      );
    } catch (error) {
      reportIssueBackend({
        namespace: 'CLOUDINARY_CLEANUP_REFERENCE_CHECK_FAILED',
        message: `Skipping cleanup of ${publicIdToUrl.size} assets — reference check failed (fail-closed: an asset in use must never be deleted)`,
        payload: {
          assetCount: publicIdToUrl.size,
          error: error instanceof Error ? error.message : String(error),
        },
        mode: 'error',
      });
      return;
    }

    const publicIds = [...publicIdToUrl.entries()]
      .filter(([, url]) => deletableUrls.has(url))
      .map(([publicId]) => publicId);

    if (publicIds.length === 0) {
      return;
    }

    const totalCount = publicIds.length;

    for (let offset = 0; offset < publicIds.length; offset += BATCH_SIZE) {
      const chunk = publicIds.slice(offset, offset + BATCH_SIZE);
      try {
        const result = await batchDeleteWithRetry(chunk);
        const deleted = result.deleted ?? {};
        for (const id of chunk) {
          const status = deleted[id];
          if (status === 'deleted' || status === 'not_found') {
            continue;
          }
          // Unknown status — log per-id (rare; usually means access denied or quota).
          reportIssueBackend({
            namespace: 'CLOUDINARY_CLEANUP_UNEXPECTED_STATUS',
            message: `Unexpected delete_resources status for ${id}: ${status ?? 'undefined'}`,
            payload: {
              publicId: id,
              assetUrl: publicIdToUrl.get(id),
              status: status ?? null,
              partial: result.partial ?? false,
            },
            mode: 'error',
          });
        }
      } catch (error) {
        reportIssueBackend({
          namespace: 'CLOUDINARY_CLEANUP_FAILED',
          message: `Failed to batch-delete ${chunk.length} assets from Cloudinary after ${RETRY_ATTEMPTS} attempts (chunk ${offset / BATCH_SIZE + 1} of ${Math.ceil(totalCount / BATCH_SIZE)})`,
          payload: {
            chunkSize: chunk.length,
            chunkOffset: offset,
            totalCount,
            attempts: RETRY_ATTEMPTS,
            // Identyfikatory MUSZA byc w logu: bez nich nieudane kasowanie jest
            // nie do ponowienia, nie do zaudytowania i nie do udowodnienia przy
            // obowiazku usuniecia danych. Wczesniej payload nie niosl ani jednego
            // `public_id`, a blad schodzil do `[object Object]` (zmierzone na zywym
            // logu deva) — czyli awaria NIEODWRACALNEJ operacji nie zostawiala sladu.
            publicIds: [...chunk],
            error:
              error instanceof Error
                ? `${error.name}: ${error.message}`
                : typeof error === 'object' && error !== null
                  ? JSON.stringify(error)
                  : String(error),
          },
          mode: 'error',
        });
        // Continue with the next chunk — partial cleanup is better than zero cleanup.
      }
    }
  });
};
