/**
 * Support LIST + THREAD-VIEW unit tests (findings F1/F2/F3).
 *
 * Zamknięte tu zachowania, które wcześniej cicho gniły:
 *
 *  - lista wątków (user + admin) NIE zagnieżdża `messages`/`_count` w findMany —
 *    Prisma tnie zagnieżdżone to-many `take` dopiero w Node (dziecko dostaje OFFSET
 *    bez LIMIT-u), a relacyjny `_count` robi nieskorelowany GROUP BY po całej tabeli;
 *    podgląd i licznik przychodzą z jednego skorelowanego LATERAL-a;
 *  - agregat mapuje się po thread_id, a brak agregatu (wątek skasowany między
 *    zapytaniami) daje pusty podgląd, nie 500;
 *  - admin widzi NAJNOWSZE 200 wiadomości (desc + reverse), tak samo jak user —
 *    wcześniej `asc` pokazywał operatorowi NAJSTARSZE 200, czyli inną połowę rozmowy.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import { getSupportThreads_IO } from './support-thread-queries.operations';
import {
  adminGetAllThreads_IO,
  adminGetThreadMessages_IO,
} from './support-admin.operations';

type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: unknown): RawStub => fn as RawStub;

const USER_ID = 'usr_test_0000000000000001';
const THREAD_A = 'cmt_thread_a000000000001';
const THREAD_B = 'cmt_thread_b000000000002';

const adminCaller = makeStylistCurrentUser({
  user: { id: 'usr_admin_000000000000001', role_id: SystemRoleId.MASTER_ADMIN },
});

const threadRow = (id: string) => ({
  id,
  subject: `Subject ${id}`,
  status: 'OPEN',
  created_at: new Date('2026-05-01T10:00:00.000Z'),
  updated_at: new Date('2026-05-02T10:00:00.000Z'),
  user_id: USER_ID,
});

describe('getSupportThreads_IO — preview i licznik ze skorelowanego LATERAL-a', () => {
  it('nie zagnieżdża messages/_count w findMany i mapuje agregat po thread_id', async () => {
    const findMany = vi.fn(async (_args: unknown) => [
      threadRow(THREAD_A),
      threadRow(THREAD_B),
    ]);
    const queryRaw = vi.fn(async () => [
      {
        thread_id: THREAD_A,
        last_message_preview: 'ostatnia wiadomość',
        last_message_sender_type: 'SUPPORT',
        message_count: 7,
      },
      // THREAD_B celowo bez agregatu — symuluje wątek skasowany między zapytaniami.
    ]);
    mockDb({
      supportThread: { findMany, findFirst: async () => null },
      $queryRaw: rawStub(queryRaw),
    });

    const result = await getSupportThreads_IO(USER_ID);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const selectArg = (
      findMany.mock.calls[0]?.[0] as { select: Record<string, unknown> }
    ).select;
    expect(selectArg).not.toHaveProperty('messages');
    expect(selectArg).not.toHaveProperty('_count');
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result.data.threads[0]).toMatchObject({
      id: THREAD_A,
      last_message_preview: 'ostatnia wiadomość',
      last_message_sender_type: 'SUPPORT',
      message_count: 7,
    });
    expect(result.data.threads[1]).toMatchObject({
      id: THREAD_B,
      last_message_preview: null,
      last_message_sender_type: null,
      message_count: 0,
    });
  });

  it('pusta strona → zero zapytań agregujących', async () => {
    const queryRaw = vi.fn(async () => []);
    mockDb({
      supportThread: { findMany: async () => [], findFirst: async () => null },
      $queryRaw: rawStub(queryRaw),
    });

    const result = await getSupportThreads_IO(USER_ID);

    expect(result.success).toBe(true);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('adminGetAllThreads_IO — ten sam agregat po stronie admina', () => {
  it('nie zagnieżdża messages/_count i dokleja dane właściciela wątku', async () => {
    const findMany = vi.fn(async (_args: unknown) => [threadRow(THREAD_A)]);
    const queryRaw = vi.fn(async () => [
      {
        thread_id: THREAD_A,
        last_message_preview: 'pytanie klientki',
        last_message_sender_type: 'USER',
        message_count: 3,
      },
    ]);
    mockDb({
      supportThread: { findMany, findFirst: async () => null },
      user: {
        findMany: async () => [
          { id: USER_ID, email: 'klientka@test.local', name: 'Klientka' },
        ],
      },
      $queryRaw: rawStub(queryRaw),
    });

    const result = await adminGetAllThreads_IO(adminCaller);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const selectArg = (
      findMany.mock.calls[0]?.[0] as { select: Record<string, unknown> }
    ).select;
    expect(selectArg).not.toHaveProperty('messages');
    expect(selectArg).not.toHaveProperty('_count');
    expect(result.data.threads[0]).toMatchObject({
      id: THREAD_A,
      user_email: 'klientka@test.local',
      last_message_preview: 'pytanie klientki',
      last_message_sender_type: 'USER',
      message_count: 3,
    });
  });
});

describe('adminGetThreadMessages_IO — obcięcie do NAJNOWSZYCH 200 (parytet z user-side)', () => {
  it('pobiera desc + take 200 i oddaje chronologiczne ASC', async () => {
    const findUnique = vi.fn(async (_args: unknown) => ({
      id: THREAD_A,
      subject: 'Subject',
      status: 'OPEN',
      updated_at: new Date('2026-05-02T10:00:00.000Z'),
      user_id: USER_ID,
      // Kolejność jak z bazy przy orderBy desc: najnowsza pierwsza.
      messages: [
        {
          id: 'msg_new',
          thread_id: THREAD_A,
          sender_type: 'USER',
          content: 'najnowsza',
          created_at: new Date('2026-05-02T10:00:00.000Z'),
        },
        {
          id: 'msg_old',
          thread_id: THREAD_A,
          sender_type: 'SUPPORT',
          content: 'starsza',
          created_at: new Date('2026-05-01T10:00:00.000Z'),
        },
      ],
    }));
    // Tożsamość autora rozwiązywana osobnym zapytaniem (soft-FK, jak w liście).
    const userFindUnique = vi.fn(async (_args: unknown) => ({
      email: 'klientka@test.local',
      name: 'Klientka Testowa',
    }));
    mockDb({
      supportThread: { findUnique },
      user: { findUnique: userFindUnique },
    });

    const result = await adminGetThreadMessages_IO(THREAD_A, adminCaller);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const messagesArg = (
      findUnique.mock.calls[0]?.[0] as {
        select: { messages: { orderBy: { created_at: string }; take: number } };
      }
    ).select.messages;
    expect(messagesArg.orderBy).toEqual({ created_at: 'desc' });
    expect(messagesArg.take).toBe(200);
    expect(result.data.messages.map(m => m.id)).toEqual(['msg_old', 'msg_new']);
    // Szczegół wątku niesie tę samą tożsamość co lista — inaczej operator widzi
    // nazwisko na liście i „Klient" po wejściu w ten sam wątek.
    expect(result.data.thread).toMatchObject({
      user_email: 'klientka@test.local',
      user_name: 'Klientka Testowa',
    });
  });

  it('osierocony wątek (konto usunięte po 90 dniach) oddaje puste dane autora, nie 500', async () => {
    const findUnique = vi.fn(async (_args: unknown) => ({
      id: THREAD_A,
      subject: 'Subject',
      status: 'OPEN',
      updated_at: new Date('2026-05-02T10:00:00.000Z'),
      user_id: USER_ID,
      messages: [],
    }));
    mockDb({
      supportThread: { findUnique },
      user: { findUnique: async () => null },
    });

    const result = await adminGetThreadMessages_IO(THREAD_A, adminCaller);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.thread).toMatchObject({ user_email: '', user_name: '' });
  });
});
