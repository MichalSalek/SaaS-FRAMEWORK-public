import crypto from 'crypto';
import { DB_CLIENT } from '@app/db/db.client';
import { isP2002 } from '@app/db/prisma-error';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  NewsletterError,
  NewsletterAlreadySubscribedError,
  NewsletterSubscribeFailedError,
} from '@kernel/domain/newsletter/newsletter-errors.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { DatabaseError } from '@kernel/application/common-errors.types';

type NewsletterSubscribeSuccess = {
  subscribed: true;
  pending_confirmation: true;
};

type NewsletterSubscribeInput = {
  email: string;
  ipAddress?: string;
  consentSource?: string;
  locale?: LocaleType;
};

const generateConfirmationToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

const buildConfirmationUrl = (token: string, locale: LocaleType): string =>
  `${buildFrontendBaseUrl()}/api/v1/public/newsletter-confirm/${encodeURIComponent(token)}?locale=${locale}`;

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

// Randomized latency floor for timing-oracle mitigation. Applied to BOTH success
// branches (ALREADY_SUBSCRIBED fast-path AND fresh/pending subscribe) so response
// time cannot distinguish a confirmed-member email from a non-member one.
const SUBSCRIBE_TIMING_FLOOR_BASE_MS = 400;
const SUBSCRIBE_TIMING_FLOOR_JITTER_MS = 300;

// DECISION (nie usuwaj tego komentarza) — finding C1 (timing-enumeration oracle):
// Floor stosowany do OBU sciezek sukcesu, nie tylko ALREADY_SUBSCRIBED. Wczesniej floor
// bramkowal WYLACZNIE fast-path, a fresh-subscribe wracal w tempie realnej dostawy maila
// (dev stub ~15ms; prod Resend ~150-400ms) — CZESTO PONIZEJ floora 400ms. Jednostronny
// floor nie moze zrownac dwoch roznych profili latencji: member-path byl systematycznie
// WOLNIEJSZY (>=400ms) niz non-member (czesto <400ms) → pojedynczy pomiar klasyfikowal
// czlonkostwo. Floorujac RÓWNIEZ fresh-path oba lezą w [400,700)ms i faktycznie sie
// nakladaja (premisa oryginalnego DECISION teraz spelniona). Rezydualny (swiadomie NIE
// zamkniety): przy AWARII dostawy maila fresh-path zwraca 500 SUBSCRIBE_FAILED przed
// floorem, a ALREADY_SUBSCRIBED nadal 200 → slaby content-oracle 200-vs-500 warunkowany
// awaria maila (stan alarmowy sam w sobie); domkniecie wymagaloby zwracania sukcesu mimo
// nieudanej dostawy, co lamie double-opt-in UX (user nie wie ze mail nie doszedl). Leaked
// fact = czlonkostwo w newsletterze marketingowym (niska wrazliwosc). Trade-off zaakceptowany.
const enforceSubscribeTimingFloor = async (
  operationStart: number
): Promise<void> => {
  const elapsed = Date.now() - operationStart;
  const floor =
    SUBSCRIBE_TIMING_FLOOR_BASE_MS +
    Math.random() * SUBSCRIBE_TIMING_FLOOR_JITTER_MS;
  if (elapsed < floor) {
    await sleep(floor - elapsed);
  }
};

export const newsletterSubscribe_IO = async ({
  email,
  ipAddress,
  consentSource,
  locale,
}: NewsletterSubscribeInput): Promise<
  OperationResult<
    NewsletterSubscribeSuccess,
    | NewsletterAlreadySubscribedError
    | NewsletterSubscribeFailedError
    | DatabaseError
  >
> => {
  const operationStart = Date.now();
  const normalizedEmail = email.trim().toLowerCase();
  const confirmationToken = generateConfirmationToken();
  const resolvedLocale = getLocaleOrDefault(locale);

  try {
    // Check if already subscribed
    const existing = await DB_CLIENT.use.newsletterSubscriber.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        is_active: true,
        confirmed_at: true,
      },
    });

    if (existing) {
      if (existing.is_active && existing.confirmed_at) {
        // Timing-oracle mitigation (member fast-path). The same floor is applied to
        // the fresh-subscribe success return below, so both success branches land in
        // the same [400,700)ms band and response time cannot reveal membership. Jitter
        // prevents a fixed-threshold classifier. Full rationale + residual: the
        // enforceSubscribeTimingFloor DECISION block above.
        await enforceSubscribeTimingFloor(operationStart);
        return failure({ type: 'ALREADY_SUBSCRIBED' });
      }

      // Pending or previously unsubscribed — rotate token and resend confirmation email.
      // DECISION (nie usuwaj tego komentarza):
      // Ten update (i bliźniaczy P2002-rotate niżej) używa gołego `update({where:email})`
      // BEZ CAS-guardu — inaczej niż confirm/unsubscribe (tam CAS deduplikuje consent-events
      // przy double-click). Tu CAS jest zbędny: (1) subscribe NIE tworzy consent-eventu
      // (event powstaje dopiero przy confirm), więc nie ma czego dedupować; (2) teoretyczny
      // "goły update cofa świeżo-potwierdzoną zgodę" NIE ma wektora — nowy token jest losowy
      // (randomBytes) i nieznany zanim mail dojdzie, a potwierdzenie wymaga kliknięcia linka
      // z maila (sekundy: delivery+klik), podczas gdy okno read→write tej operacji to
      // milisekundy; user-confirm nie może trafić w to okno. Współbieżny subscribe↔unsubscribe
      // rozstrzyga się poprawnie w obie strony (unsubscribe CAS-guard na `OR[is_active,token]`
      // wygrywa gdy wchodzi po rotacji; jest no-opem gdy rekord już wypisany).
      await DB_CLIENT.use.newsletterSubscriber.update({
        where: { email: normalizedEmail },
        data: {
          confirmation_token: confirmationToken,
          is_active: false,
          confirmed_at: null,
          consent_timestamp: null,
          ...(ipAddress !== undefined ? { ip_address: ipAddress } : {}),
          ...(consentSource !== undefined
            ? { consent_source: consentSource }
            : {}),
        },
      });
    } else {
      // New subscriber — pending confirmation.
      try {
        await DB_CLIENT.use.newsletterSubscriber.create({
          data: {
            email: normalizedEmail,
            is_active: false,
            confirmation_token: confirmationToken,
            ...(ipAddress !== undefined ? { ip_address: ipAddress } : {}),
            ...(consentSource !== undefined
              ? { consent_source: consentSource }
              : {}),
          },
        });
      } catch (createError) {
        // DECISION (nie usuwaj tego komentarza): P2002 wykrywany STRUKTURALNIE (isP2002), NIE
        // `instanceof Prisma.PrismaClientKnownRequestError` — instanceof zwraca FALSE pod
        // Turbopack (zdublowane tożsamości klasy) → współbieżny subscribe (row utworzony
        // między findUnique a create) byłby przeskoczony i rzucony jako SUBSCRIBE_FAILED
        // zamiast idempotentnej rotacji tokenu. Rationale: @app/db/prisma-error.ts.
        if (isP2002(createError)) {
          // Concurrent subscribe — row created between our findUnique and create.
          // Rotate token on the now-existing row (same as "pending" branch above).
          // Full parity with the pending branch: reset confirmed_at AND
          // consent_timestamp to null so both rotation paths land the row in an
          // identical clean-pending state (guards against a stale consent_timestamp
          // co-existing with confirmed_at:null if the create path ever seeds one).
          await DB_CLIENT.use.newsletterSubscriber.update({
            where: { email: normalizedEmail },
            data: {
              confirmation_token: confirmationToken,
              is_active: false,
              confirmed_at: null,
              consent_timestamp: null,
              ...(ipAddress !== undefined ? { ip_address: ipAddress } : {}),
              ...(consentSource !== undefined
                ? { consent_source: consentSource }
                : {}),
            },
          });
        } else {
          throw createError;
        }
      }
    }
  } catch (error) {
    // DECISION (nie usuwaj tego komentarza) — AWARIA DB NA PUBLICZNYM ZBIERANIU ZGODY
    // MUSI BYĆ WIDOCZNA:
    // ten catch obejmuje WYŁĄCZNIE operacje bazodanowe (findUnique/create/update),
    // a wcześniej pakował je w `SUBSCRIBE_FAILED` z `reason: error.message` — pole,
    // którego nikt nie czyta: mapper zwraca `respondGeneralError(res, undefined)`,
    // więc `reason` nie trafiał ani do klienta, ani do logu. Padnięcie bazy na
    // nieuwierzytelnionym, publicznym endpointcie zgody było więc CAŁKOWICIE
    // niewidoczne (zero wpisów w Event Logu, zero alertu PostHog). `databaseFailure`
    // to kanoniczna ścieżka w tym repo: raportuje (namespace DATABASE_ERROR, stack)
    // i dopiero potem zwraca `DATABASE_ERROR`. Kontrakt wobec klienta bez zmian —
    // DATABASE_ERROR i SUBSCRIBE_FAILED mapują się na to samo nieprzezroczyste 500,
    // więc komunikat sterownika nadal nie wycieka i nie powstaje nowy oracle.
    return databaseFailure('newsletterSubscribe_IO', error);
  }

  // Email send: AWAIT delivery (RODO double opt-in flow is critical).
  // sendTransactionalEmail never throws — returns false on failure and reports
  // internally via reportIssueBackend. Check return value to surface SUBSCRIBE_FAILED.
  const confirmUrl = buildConfirmationUrl(confirmationToken, resolvedLocale);
  const sent = await sendTransactionalEmail(
    'newsletter-confirm',
    { email: normalizedEmail },
    APP_EVENTS.INFO.NEWSLETTER.NEWSLETTER_PENDING_CONFIRMATION,
    { confirmUrl },
    'email.newsletter.confirm.subject',
    resolvedLocale
  );
  if (!sent) {
    return failure({
      type: 'SUBSCRIBE_FAILED',
      reason: 'Confirmation email delivery failed',
    });
  }

  // Timing-oracle mitigation: floor the fresh-subscribe success to the same
  // [400,700)ms band as the ALREADY_SUBSCRIBED path so response time cannot
  // distinguish a member email from a non-member one (finding C1).
  await enforceSubscribeTimingFloor(operationStart);
  return success({ subscribed: true, pending_confirmation: true });
};

// Re-export the broader union for consumers that need exhaustive handling.
export type NewsletterSubscribeError = NewsletterError;
