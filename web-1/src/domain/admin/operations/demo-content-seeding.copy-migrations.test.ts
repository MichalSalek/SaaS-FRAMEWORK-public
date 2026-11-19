import { beforeEach, describe, expect, it, vi } from 'vitest';

type SessionRow = {
  id: string;
  client_note: string | null;
  stylist_note: string | null;
};

type SupportMessageRow = {
  thread_id: string;
  sender_type: string;
  content: string;
};

const { state, db } = vi.hoisted(() => {
  const state = {
    sessions: [] as SessionRow[],
    supportMessages: [] as SupportMessageRow[],
    supportThreads: [] as {
      id: string;
      user_id: string;
      subject: string;
    }[],
  };
  const db = {
    use: {
      sessionContainer: {
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: {
              id: string;
              client_note?: { in: string[] };
              stylist_note?: { in: string[] };
            };
            data: { client_note?: string; stylist_note?: string };
          }) => {
            let count = 0;
            for (const session of state.sessions) {
              if (session.id !== where.id) {
                continue;
              }
              if (
                where.client_note &&
                session.client_note !== null &&
                where.client_note.in.includes(session.client_note)
              ) {
                session.client_note = data.client_note ?? session.client_note;
                count++;
              }
              if (
                where.stylist_note &&
                session.stylist_note !== null &&
                where.stylist_note.in.includes(session.stylist_note)
              ) {
                session.stylist_note =
                  data.stylist_note ?? session.stylist_note;
                count++;
              }
            }
            return { count };
          }
        ),
      },
      supportMessage: {
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: {
              thread_id: string;
              sender_type: string;
              content: string;
            };
            data: { content: string };
          }) => {
            let count = 0;
            for (const message of state.supportMessages) {
              if (
                message.thread_id === where.thread_id &&
                message.sender_type === where.sender_type &&
                message.content === where.content
              ) {
                message.content = data.content;
                count++;
              }
            }
            return { count };
          }
        ),
      },
      supportThread: {
        findFirst: vi.fn(
          async ({ where }: { where: { user_id: string; subject: string } }) =>
            state.supportThreads.find(
              thread =>
                thread.user_id === where.user_id &&
                thread.subject === where.subject
            ) ?? null
        ),
        create: vi.fn(),
      },
    },
  };
  return { state, db };
});

vi.mock('@app/db/db.client', () => ({ DB_CLIENT: db }));

import { SupportSenderTypeValue } from '@kernel/models/db_models.generated.dto';
import { refreshRetiredSessionNotes_IO } from './demo-content-seeding.sessions';
import { ensureDemoSupportThread_IO } from './demo-content-seeding.support-migration';
import {
  DEMO_SESSION_OLA,
  DEMO_SUPPORT_THREAD,
} from './demo-content-seeding.config';
import { DEMO_COMMUNITY_PAIRS } from './demo-content-seeding.community-data';

const OLD_SUPPORT_REPLY = DEMO_SUPPORT_THREAD.retired_support_reply;

beforeEach(() => {
  vi.clearAllMocks();
  state.sessions = [
    {
      id: 'session-ola',
      client_note: null,
      stylist_note:
        'Proponuję delikatny beż i odrobinę perłowego brokatu na serdecznym palcu. Będzie pasować do każdej sukienki.',
    },
    {
      id: 'session-community',
      client_note: null,
      stylist_note:
        'Proponuję nude z cienką złotą linią, spokojnie zniesie plażę.',
    },
    {
      id: 'session-manual',
      client_note: null,
      stylist_note: 'Ręczna notatka osoby testującej.',
    },
  ];
  state.supportMessages = [
    {
      thread_id: 'demo-thread',
      sender_type: SupportSenderTypeValue.SUPPORT,
      content: OLD_SUPPORT_REPLY,
    },
    {
      thread_id: 'demo-thread',
      sender_type: SupportSenderTypeValue.USER,
      content: OLD_SUPPORT_REPLY,
    },
    {
      thread_id: 'other-thread',
      sender_type: SupportSenderTypeValue.SUPPORT,
      content: OLD_SUPPORT_REPLY,
    },
    {
      thread_id: 'demo-thread',
      sender_type: SupportSenderTypeValue.SUPPORT,
      content: 'Ręczna odpowiedź administratora.',
    },
  ];
  state.supportThreads = [
    {
      id: 'demo-thread',
      user_id: 'user-karolina',
      subject: DEMO_SUPPORT_THREAD.subject,
    },
    {
      id: 'other-thread',
      user_id: 'other-user',
      subject: DEMO_SUPPORT_THREAD.subject,
    },
  ];
});

describe('demo seed: migracja zmienionych tekstów', () => {
  it('odświeża wyłącznie starą notatkę seedowanej sesji', async () => {
    await refreshRetiredSessionNotes_IO('session-ola', {
      stylistNote: DEMO_SESSION_OLA.stylist_note,
    });
    const communitySession = DEMO_COMMUNITY_PAIRS.find(
      pair => pair.session?.name === 'Manicure na wyjazd'
    )?.session;
    const communityStylistNote = communitySession?.stylistNote;
    if (communityStylistNote === undefined) {
      throw new Error('Missing community session fixture');
    }
    expect(communityStylistNote).toBe(
      'Proponuję nude z cienką złotą linią. To spokojna propozycja na wyjazd.'
    );
    await refreshRetiredSessionNotes_IO('session-community', {
      stylistNote: communityStylistNote,
    });

    expect(state.sessions).toEqual([
      {
        id: 'session-ola',
        client_note: null,
        stylist_note: DEMO_SESSION_OLA.stylist_note,
      },
      {
        id: 'session-community',
        client_note: null,
        stylist_note: communityStylistNote,
      },
      {
        id: 'session-manual',
        client_note: null,
        stylist_note: 'Ręczna notatka osoby testującej.',
      },
    ]);
  });

  it('aktualizuje tylko starą odpowiedź wsparcia w wybranym wątku', async () => {
    await ensureDemoSupportThread_IO({
      userId: 'user-karolina',
      now: new Date('2026-10-30T12:00:00.000Z'),
      results: [],
    });

    expect(db.use.supportThread.create).not.toHaveBeenCalled();
    expect(db.use.supportThread.findFirst).toHaveBeenCalledWith({
      where: {
        user_id: 'user-karolina',
        subject: DEMO_SUPPORT_THREAD.subject,
      },
    });

    expect(state.supportMessages).toEqual([
      {
        thread_id: 'demo-thread',
        sender_type: SupportSenderTypeValue.SUPPORT,
        content: DEMO_SUPPORT_THREAD.support_reply,
      },
      {
        thread_id: 'demo-thread',
        sender_type: SupportSenderTypeValue.USER,
        content: OLD_SUPPORT_REPLY,
      },
      {
        thread_id: 'other-thread',
        sender_type: SupportSenderTypeValue.SUPPORT,
        content: OLD_SUPPORT_REPLY,
      },
      {
        thread_id: 'demo-thread',
        sender_type: SupportSenderTypeValue.SUPPORT,
        content: 'Ręczna odpowiedź administratora.',
      },
    ]);
  });
});
