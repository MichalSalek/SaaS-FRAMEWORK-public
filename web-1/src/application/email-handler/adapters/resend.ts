import { Resend, type CreateEmailRequestOptions } from 'resend';
import { ENV_VARS } from '@app/environment/environment.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { type SendEmailParams } from '@app/email-handler/email.types';
import { shouldStubEmailSend } from '@app/email-handler/email-dev-sink';
import { HTTP_CLIENT_CONFIG } from '@kernel/application/constants.config';

/**
 * Lazy singleton Resend client (parity z adapterem Mailgun).
 * Tworzony raz przy pierwszym użyciu, cache na poziomie modułu.
 */
let _resendClient: Resend | null = null;

const getResendClient = (): Resend => {
  if (_resendClient) {
    return _resendClient;
  }

  const apiKey = ENV_VARS.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('Resend configuration is missing (RESEND_API_KEY)');
  }

  _resendClient = new Resend(apiKey);
  return _resendClient;
};

/**
 * Wysyłka maila przez Resend (primary, gdy RESEND_ENABLED=true).
 * Ta sama sygnatura co adapter Mailgun — pełna wymienność w łańcuchu transportów
 * (email-transport.ts / magic-link.adapter.ts). RZUCA przy błędzie, by uruchomić
 * fallback na Mailgun.
 */
/**
 * Nadawca Resend — stała na zweryfikowanej w Resend domenie (nailfolio.app), NIE env.
 * Świadomie bez osobnej zmiennej (anty env-sprawl): domena tej apki jest niezmienna,
 * a Mailgun fallback ma własny FROM_EMAIL.
 */
const RESEND_FROM = 'noreply@nailfolio.app';

export const sendEmail = async (params: SendEmailParams): Promise<void> => {
  const from = RESEND_FROM;

  // Dev quota guard (parity z Mailgun): w DEVELOPMENT pierwszy send to canary,
  // reszta stub, by iteracja nie paliła dziennego limitu Resend.
  // Prod NIGDY nie stubuje.
  if (
    shouldStubEmailSend({
      to: params.to,
      subject: params.subject,
      transport: 'resend',
    })
  ) {
    return;
  }

  const client = getResendClient();

  // DECISION (nie usuwaj tego komentarza):
  // Resend NIE przepisuje linków domyślnie (click-tracking jest opt-in per send /
  // w dashboardzie), więc magic-link (params.disableClickTracking) jest bezpieczny
  // bez dodatkowej akcji — href zostaje surowy (Universal/App Link działa, token
  // jednorazowy nie wycieka do ESP). Inaczej niż Mailgun, który wymaga jawnego
  // o:tracking-clicks=no. Stąd disableClickTracking jest tu no-op (świadomie).
  // DECISION (nie usuwaj tego komentarza) — bounded like the other transports
  // (testy-api s34 review): the SDK calls a bare fetch, so a stalled Resend socket
  // held the whole send (and the retry cascade) for Node's multi-minute default,
  // and runEmailRequestOnce makes duplicate clicks wait on that same send. The SDK
  // spreads request options into fetch() (resend post(): `{ ...options }`), so an
  // AbortSignal works although its option TYPES do not list it; the variable keeps
  // the call cast-free. Budget = Mailgun's client timeout.
  const requestOptions: CreateEmailRequestOptions & { signal: AbortSignal } = {
    signal: AbortSignal.timeout(HTTP_CLIENT_CONFIG.TIMEOUT_MS),
  };
  const { error } = await client.emails.send(
    {
      from,
      to: params.to,
      subject: params.subject,
      text: params.text ?? ' ',
      html: params.html,
      ...(params.headers && Object.keys(params.headers).length > 0
        ? { headers: params.headers }
        : {}),
      ...(params.tags && params.tags.length > 0
        ? { tags: params.tags.map(tag => ({ name: tag, value: tag })) }
        : {}),
    },
    requestOptions
  );

  // DECISION (nie usuwaj tego komentarza):
  // Resend SDK NIE rzuca przy błędzie API — zwraca { data, error }. Rzucamy sami,
  // by łańcuch fallbacku (Mailgun → SMTP) w email-transport / magic-link zadziałał.
  if (error) {
    reportIssueBackend({
      namespace: 'RESEND_SEND_ERROR',
      message: 'Failed to send email via Resend',
      payload: { error, to: params.to, subject: params.subject },
      mode: 'error',
    });
    throw new Error(
      `Resend send failed: ${error.message ?? error.name ?? 'unknown'}`
    );
  }
};
