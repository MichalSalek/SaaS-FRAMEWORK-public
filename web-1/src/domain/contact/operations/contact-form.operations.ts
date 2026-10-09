import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { ContactError } from '@kernel/domain/contact/contact-errors.types';
import type { ContactTopic } from '@kernel/domain/support/contact-topics.config';
import { sendLifecycleEmail } from '@app/email-handler/email-transport';
import { getPrimaryAdminEmail } from '@app/admin/admin.utils.api';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { runAfterResponse } from '@app/runtime/run-after-response';

type ContactFormInput = {
  name: string;
  topic: ContactTopic;
  email: string;
  message: string;
};

type ContactFormSuccess = {
  submitted: true;
};

const TOPIC_LABELS: Record<ContactTopic, string> = {
  stylistka: 'Pytanie stylistki o aplikację',
  klientka: 'Pytanie klientki o konto lub galerię',
  cennik: 'Plany i ceny',
  bug: 'Błąd lub sugestia techniczna',
  wspolpraca: 'Współpraca lub partnerstwo',
  inne: 'Inne',
};

function escapeForEmail(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// DECISION (nie usuwaj tego komentarza) — W LOGACH SAMA DOMENA NADAWCY, NIGDY IMIĘ
// I ADRES:
// oba wpisy CONTACT_FORM niosły `{name, email}`, a ten z gałęzi „brak admin-maila"
// leci w `mode:'error'`, czyli BEZWARUNKOWO (błąd omija bramkę debug-mode i throttling
// loggera). Event Log ma retencję 90 dni i NIE redaguje klucza `email`
// (SENSITIVE_KEY_REGEX w error-handler.ts pokrywa wyłącznie sekrety), więc publiczny,
// nieuwierzytelniony formularz budował trwałą listę nazwisk i adresów w log-storze —
// dane, których sam produkt nie przechowuje nigdzie indziej (wiadomość idzie mailem
// do admina i tyle).
// Diagnostyka, którą to zachowuje: `topic` (co się psuje) + `senderDomain` (fala spamu
// z jednej domeny widoczna jak dawniej), a wpis i tak wisi na `event_log_chain_id`
// requestu, więc korelacja z resztą śladu żyje. Świadomie NIE hashujemy adresu —
// przestrzeń e-maili jest słownikowa, więc hash bez sekretu to pseudonimizacja
// udająca anonimizację; sama domena nie identyfikuje nikogo.
// Utrata, która jest tu ZAAKCEPTOWANA: przy zgubionej wiadomości nie odpiszemy
// nadawcy z logu. Naprawą jest konfiguracja admin-maila (user dostaje 500 i ponawia),
// a nie trzymanie jego danych na wypadek naszej awarii.
const emailDomain = (email: string): string => {
  const at = email.lastIndexOf('@');
  return at === -1 ? 'unknown' : email.slice(at + 1).toLowerCase();
};

export type ContactFormError = ContactError;

export const submitContactForm_IO = async (
  body: ContactFormInput
): Promise<OperationResult<ContactFormSuccess, ContactFormError>> => {
  const adminEmail = getPrimaryAdminEmail();

  if (!adminEmail) {
    reportIssueBackend({
      namespace: 'CONTACT_FORM',
      message: 'No admin email configured — contact form message lost',
      payload: { topic: body.topic, senderDomain: emailDomain(body.email) },
      mode: 'error',
    });
    return failure({ type: 'CONTACT_FORM_NO_ADMIN_EMAIL' });
  }

  const topicLabel = TOPIC_LABELS[body.topic] ?? body.topic;
  // Header-injection parity with the sanitized Reply-To below: subject is an
  // SMTP header too — strip CRLF from the user-controlled name.
  const safeName = body.name.replace(/[\r\n]+/g, ' ');
  const subject = `[Nailfolio Kontakt] ${topicLabel}: ${safeName}`;

  const html = `
    <h2>Nowa wiadomość z formularza kontaktowego</h2>
    <table style="border-collapse:collapse;width:100%;max-width:600px">
      <tr><td style="padding:8px;font-weight:bold">Imię i nazwisko</td><td style="padding:8px">${escapeForEmail(body.name)}</td></tr>
      <tr><td style="padding:8px;font-weight:bold">Email</td><td style="padding:8px"><a href="mailto:${escapeForEmail(body.email)}">${escapeForEmail(body.email)}</a></td></tr>
      <tr><td style="padding:8px;font-weight:bold">Temat</td><td style="padding:8px">${escapeForEmail(topicLabel)}</td></tr>
      <tr><td style="padding:8px;font-weight:bold">Wiadomość</td><td style="padding:8px;white-space:pre-wrap">${escapeForEmail(body.message)}</td></tr>
    </table>
  `.trim();

  const text = [
    `Imię i nazwisko: ${body.name}`,
    `Email: ${body.email}`,
    `Temat: ${topicLabel}`,
    `Wiadomość:\n${body.message}`,
  ].join('\n');

  const sent = await sendLifecycleEmail({
    to: adminEmail,
    subject,
    html,
    text,
    templateId: 'contact-form',
    tags: ['contact-form'],
    headers: { 'Reply-To': body.email.replace(/[\r\n]/g, '') },
  });

  if (!sent) {
    return failure({
      type: 'EXTERNAL_SERVICE_ERROR',
      service: 'MAILGUN',
      operation: 'submitContactForm',
    });
  }

  // Fire-and-forget: analytics tracking does not block the response.
  runAfterResponse(() =>
    Promise.resolve(
      reportIssueBackend({
        namespace: 'CONTACT_FORM',
        message: 'Contact form submitted',
        payload: { topic: body.topic, senderDomain: emailDomain(body.email) },
        mode: 'info',
      })
    )
  );

  return success({ submitted: true });
};
