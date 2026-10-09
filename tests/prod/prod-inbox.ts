// tests/prod/prod-inbox.ts
//
// Odbiór maili ze skrzynki testowej po IMAP — to jest ta część, dzięki której
// logowanie na produkcji da się przetestować automatem BEZ dorabiania w kodzie
// jakiejkolwiek obejściowej ścieżki logowania. Test robi dokładnie to, co
// człowiek: prosi o link, otwiera skrzynkę, klika.

import { ImapFlow } from 'imapflow';
import { PROD_CONFIG } from './prod-config';

export interface InboxMessage {
  subject: string;
  receivedAt: Date;
  body: string;
}

const connect = async (): Promise<ImapFlow> => {
  const client = new ImapFlow({
    host: PROD_CONFIG.IMAP_HOST,
    port: PROD_CONFIG.IMAP_PORT,
    secure: true,
    auth: {
      user: PROD_CONFIG.MAILBOX_USER,
      pass: PROD_CONFIG.MAILBOX_PASSWORD,
    },
    logger: false,
  });
  await client.connect();
  return client;
};

/**
 * Czeka na wiadomość, która dotarła PO `since` i której treść pasuje do wzorca.
 *
 * Odcięcie czasem jest tu istotne: skrzynka jest współdzielona między kolejnymi
 * uruchomieniami, a magic-link jest jednorazowy. Bez `since` test potrafiłby
 * chwycić link z poprzedniego przebiegu (już spalony) i wywrócić się na
 * „nieprawidłowy token", myląc regresję dostarczania maili z regresją logowania.
 */
export async function waitForMessage(options: {
  since: Date;
  match: RegExp;
  timeoutMs?: number;
}): Promise<{ message: InboxMessage; matched: string }> {
  const timeoutMs = options.timeoutMs ?? PROD_CONFIG.MAIL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const client = await connect();

  try {
    while (Date.now() < deadline) {
      const lock = await client.getMailboxLock('INBOX');
      try {
        for await (const msg of client.fetch(
          { since: options.since },
          { source: true, envelope: true }
        )) {
          const receivedAt = msg.envelope?.date ?? new Date(0);
          if (receivedAt.getTime() < options.since.getTime()) {
            continue;
          }
          const body = decodeSource(msg.source);
          const matched = options.match.exec(body)?.[0];
          if (matched) {
            return {
              message: {
                subject: msg.envelope?.subject ?? '',
                receivedAt,
                body,
              },
              matched,
            };
          }
        }
      } finally {
        lock.release();
      }
      await sleep(3000);
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  throw new Error(
    `Nie doczekałem się maila pasującego do ${options.match} w ciągu ${Math.round(
      timeoutMs / 1000
    )} s. Sprawdź dostarczanie (Resend/Mailgun) albo skrzynkę ${PROD_CONFIG.MAILBOX_USER}.`
  );
}

/**
 * Treść maila bywa zakodowana quoted-printable, przez co adres linku jest łamany
 * miękkimi znakami `=\r\n` i wzorzec by go nie złapał. Rozwijamy je, zanim
 * cokolwiek dopasujemy, oraz zamieniamy encje HTML, którymi kodowany jest `&`
 * w wersji HTML wiadomości.
 */
const decodeSource = (source: Buffer | undefined): string => {
  const raw = source?.toString('latin1') ?? '';
  // Full quoted-printable: soft breaks first, then every `=XX` escape back to
  // its byte (not only `=3D`: a trailing space is `=20` and used to end up
  // glued onto the link). Bytes are re-read as UTF-8 so Polish text survives.
  const bytes = raw
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  return Buffer.from(bytes, 'latin1').toString('utf-8').replace(/&amp;/g, '&');
};

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/** Kasuje wszystko ze skrzynki testowej, żeby kolejne przebiegi zaczynały czysto. */
export async function purgeInbox(): Promise<number> {
  const client = await connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // The mail host rejects FETCH 1:* with BAD when the selected mailbox is empty.
      if (client.mailbox && client.mailbox.exists === 0) {
        return 0;
      }
      const uids: number[] = [];
      for await (const msg of client.fetch({ all: true }, { uid: true })) {
        uids.push(msg.uid);
      }
      if (uids.length > 0) {
        await client.messageDelete(uids, { uid: true });
      }
      return uids.length;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}
