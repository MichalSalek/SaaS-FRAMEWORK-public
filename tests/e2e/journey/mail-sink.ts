// tests/e2e/journey/mail-sink.ts
//
// Reads the login mail from the local SMTP sink (Mailpit). The backend sends it through its real
// mail path (magic-link.adapter.ts -> adapters/smtp.ts); the sink is the only transport configured
// (tests/ci/e2e-env.sh), so no message can leave the machine. Mailpit HTTP API:
// GET /api/v1/search?query=to:"…" and GET /api/v1/message/{ID}.

import { expect } from '@playwright/test';

const MAIL_API = process.env['E2E_MAIL_API'] ?? 'http://127.0.0.1:18025';

type MailpitSearch = { messages?: Array<{ ID: string }> };
type MailpitMessage = { Subject: string; HTML: string; Text: string };

const decodeHtmlEntities = (value: string): string =>
  value.replace(/&amp;/g, '&').replace(/&#x3D;/gi, '=').replace(/&#61;/g, '=');

/** Wait for the newest login mail to `email` and return its verify link. */
export async function readMagicLink(email: string): Promise<{ subject: string; url: string }> {
  let found: { subject: string; url: string } | undefined;
  await expect
    .poll(
      async () => {
        const query = encodeURIComponent(`to:"${email}"`);
        const search = (await (await fetch(`${MAIL_API}/api/v1/search?query=${query}`)).json()) as MailpitSearch;
        const id = search.messages?.[0]?.ID;
        if (!id) {
          return false;
        }
        const message = (await (await fetch(`${MAIL_API}/api/v1/message/${id}`)).json()) as MailpitMessage;
        const href = [...message.HTML.matchAll(/href="([^"]+)"/g)]
          .map(m => decodeHtmlEntities(m[1] ?? ''))
          .find(u => u.includes('/api/auth/magic-link/verify'));
        if (!href) {
          return false;
        }
        found = { subject: message.Subject, url: href };
        return true;
      },
      { message: `no login mail for ${email} in the sink (${MAIL_API})`, timeout: 30_000, intervals: [250, 500, 1000] }
    )
    .toBe(true);
  if (!found) {
    throw new Error('unreachable: poll passed without a link');
  }
  return found;
}
