import { describe, it, expect } from 'vitest';
import {
  DEMO_SESSION_CLOSED,
  DEMO_SESSION_OLA,
  DEMO_SESSION_SHARED,
  RETIRED_SESSION_NOTES,
} from './demo-content-seeding.config';
import {
  DEMO_NEW_CLIENTS,
  RETIRED_SERVICE_NOTES,
  SERVICE_NOTE_TEMPLATES,
} from './demo-content-seeding.clients-data';
import {
  DEMO_KAROLINA_ANIA_MESSAGES,
  DEMO_KAROLINA_ANIA_RETIRED_MESSAGES,
  DEMO_KAROLINA_OLA_MESSAGES,
  DEMO_KAROLINA_OLA_RETIRED_MESSAGES,
} from './demo-content-seeding.karolina-data';
import { DEMO_NEW_CLIENT_RETIRED_MESSAGES } from './demo-content-seeding.new-clients-retired-data';
import { DEMO_COMMUNITY_PAIRS } from './demo-content-seeding.community-data';
import { DEMO_SUPPORT_THREAD } from './demo-content-seeding.config';

/**
 * Retired sentences of the demo seed. A retired sentence that returns to the
 * data is deleted and appended again on every seed (messages) or overwritten
 * (notes). A map key outside `DEMO_NEW_CLIENTS` retires nothing, and a green
 * seed run would not show that.
 */
describe('demo seed: wycofane zdania', () => {
  it('mapa wycofanych wiadomości zna tylko istniejące klientki', () => {
    const slugs = new Set(DEMO_NEW_CLIENTS.map(c => c.slug));
    for (const slug of Object.keys(DEMO_NEW_CLIENT_RETIRED_MESSAGES)) {
      expect(slugs.has(slug), slug).toBe(true);
    }
  });

  it('żadne wycofane zdanie wiadomości nie jest już w użyciu', () => {
    const threads: [readonly string[], readonly { content: string }[]][] = [
      [DEMO_KAROLINA_ANIA_RETIRED_MESSAGES, DEMO_KAROLINA_ANIA_MESSAGES],
      [DEMO_KAROLINA_OLA_RETIRED_MESSAGES, DEMO_KAROLINA_OLA_MESSAGES],
      ...DEMO_NEW_CLIENTS.map(
        c =>
          [DEMO_NEW_CLIENT_RETIRED_MESSAGES[c.slug] ?? [], c.messages] as [
            readonly string[],
            readonly { content: string }[],
          ]
      ),
    ];
    for (const [retired, messages] of threads) {
      const active = new Set(messages.map(m => m.content));
      for (const sentence of retired) {
        expect(active.has(sentence), sentence).toBe(false);
      }
    }
  });

  it('żadna wycofana notatka nie jest już w użyciu', () => {
    const activeSessionNotes = new Set<string>([
      DEMO_SESSION_SHARED.client_note,
      DEMO_SESSION_SHARED.stylist_note,
      DEMO_SESSION_CLOSED.stylist_note,
      DEMO_SESSION_OLA.client_note,
      DEMO_SESSION_OLA.stylist_note,
      ...DEMO_COMMUNITY_PAIRS.flatMap(pair =>
        pair.session
          ? [pair.session.clientNote, pair.session.stylistNote].filter(
              (note): note is string => note !== undefined
            )
          : []
      ),
      ...DEMO_NEW_CLIENTS.flatMap(c =>
        c.sharedSession ? [c.sharedSession.clientNote] : []
      ),
    ]);
    for (const note of RETIRED_SESSION_NOTES) {
      expect(activeSessionNotes.has(note), note).toBe(false);
    }
    const activeServiceNotes = new Set(SERVICE_NOTE_TEMPLATES);
    for (const note of RETIRED_SERVICE_NOTES) {
      expect(activeServiceNotes.has(note), note).toBe(false);
    }
  });

  it('zachowuje dokładne poprzednie zdania jako klucze idempotencji', () => {
    expect(DEMO_NEW_CLIENT_RETIRED_MESSAGES.zuzanna).toContain(
      'To chciałabym się umówić na przyszły tydzień.'
    );
    expect(DEMO_NEW_CLIENT_RETIRED_MESSAGES.aleksandra).toContain(
      'Nie ma problemu, używam łagodniejszego zmywacza. Dam Ci znać, jak się sprawdzi.'
    );
    expect(DEMO_NEW_CLIENT_RETIRED_MESSAGES.aleksandra).toContain(
      'Nie ma problemu, używam łagodniejszego zmywacza, dam Ci znać jak się sprawdzi.'
    );
    expect(DEMO_KAROLINA_ANIA_RETIRED_MESSAGES).toContain(
      'Ten french pasuje do średniej długości, bo cienka końcówka nie skróci paznokci.'
    );
    expect(RETIRED_SESSION_NOTES).toContain(
      'Zaproponuję delikatny beż z odrobiną perłowego brokatu na serdecznym, będzie pasować do każdej sukienki.'
    );
    expect(DEMO_SUPPORT_THREAD.support_reply).toContain(
      'Dodaj inspiracje z galerii'
    );
  });
});
