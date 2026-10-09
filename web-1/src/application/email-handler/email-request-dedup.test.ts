/**
 * Dedup powtórzonych żądań z mailem potwierdzającym (2026-09-25).
 *
 * Pinuje: podwójne wysłanie w oknie NIE wysyła drugiego maila i oddaje ten sam
 * sukces; po oknie, dla innego celu i po nieudanej wysyłce mail idzie normalnie
 * (żeby „wyślij ponownie" nie zostało zablokowane).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApiHandler, mockDb } from '../../test-utils/mockApiHandler';
import { __setCurrentUser, __setPermission } from '../../test-utils/setup';
import {
  makeCurrentUserOutput,
  makeStylistCurrentUser,
} from '../../test-utils/fixtures';

vi.mock('@app/email-handler/email-transactional', () => ({
  sendTransactionalEmail: vi.fn(async () => true),
}));
vi.mock('@app/email-handler/email-locale.resolver', () => ({
  resolveLocaleByEmail: vi.fn(async () => 'pl'),
}));

import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import {
  EMAIL_REQUEST_DEDUP_WINDOW_MS,
  __resetEmailRequestDedup,
  runEmailRequestOnce,
} from './email-request-dedup';
import { changeUserEmail_IO } from '@domain/user/operations/user-email-change.operations';
import deleteSelfHandler from '../../pages/api/v1/user/delete/self/index';

const sent = vi.mocked(sendTransactionalEmail);

beforeEach(() => {
  __resetEmailRequestDedup();
  sent.mockClear();
  sent.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runEmailRequestOnce', () => {
  it('a duplicate in flight waits for the REAL result (review s34: no success on credit)', async () => {
    let finish: (ok: boolean) => void = () => undefined;
    const send = vi.fn(
      () => new Promise<boolean>(resolve => (finish = resolve))
    );
    const first = runEmailRequestOnce('k', send);
    const duplicate = runEmailRequestOnce('k', send);
    finish(false);
    await expect(first).resolves.toEqual({ sent: false, joined: false });
    await expect(duplicate).resolves.toEqual({ sent: false, joined: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('after a successful send: joined inside the window, a fresh send after it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const send = vi.fn(async () => true);
    await expect(runEmailRequestOnce('k', send)).resolves.toEqual({
      sent: true,
      joined: false,
    });
    await expect(runEmailRequestOnce('k', send)).resolves.toEqual({
      sent: true,
      joined: true,
    });
    vi.setSystemTime(Date.now() + EMAIL_REQUEST_DEDUP_WINDOW_MS);
    await runEmailRequestOnce('k', send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('a failed or throwing send frees the key at once', async () => {
    await runEmailRequestOnce('k', async () => false);
    await expect(
      runEmailRequestOnce('k', async () => {
        throw new Error('provider down');
      })
    ).rejects.toThrow('provider down');
    await expect(runEmailRequestOnce('k', async () => true)).resolves.toEqual({
      sent: true,
      joined: false,
    });
  });
});

describe('USER_REQUEST_EMAIL_CHANGE — changeUserEmail_IO', () => {
  const request = (new_email: string) =>
    changeUserEmail_IO({
      id: 'usr_dedup_1',
      new_email,
      current_email: 'stara@example.com',
      user_name: 'Ola',
    });

  beforeEach(() => {
    // Nowy adres wolny (anti-enumeration check nie przejmuje ścieżki).
    mockDb({ user: { findUnique: async () => null } });
  });

  it('powtórka w oknie → ten sam sukces, bez drugiej pary maili', async () => {
    const first = await request('nowa@example.com');
    const second = await request('nowa@example.com');

    expect(first).toEqual({
      success: true,
      data: { message: 'VERIFICATION_EMAIL_SENT' },
    });
    expect(second).toEqual(first);
    // confirm (nowy adres) + notify (stary adres) — raz, nie dwa razy.
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it('inny docelowy adres przechodzi od razu', async () => {
    await request('nowa@example.com');
    await request('inna@example.com');
    expect(sent).toHaveBeenCalledTimes(4);
  });

  it('po oknie mail idzie ponownie („wyślij ponownie")', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await request('nowa@example.com');
    vi.setSystemTime(Date.now() + EMAIL_REQUEST_DEDUP_WINDOW_MS + 1);
    await request('nowa@example.com');
    expect(sent).toHaveBeenCalledTimes(4);
  });

  it('nieudana wysyłka nie blokuje ponowienia', async () => {
    sent.mockResolvedValueOnce(false);
    const failed = await request('nowa@example.com');
    expect(failed.success).toBe(false);

    const retried = await request('nowa@example.com');
    expect(retried.success).toBe(true);
    // 1 nieudany confirm + confirm i notify z ponowienia
    expect(sent).toHaveBeenCalledTimes(3);
  });
});

describe('USER_REQUEST_DELETE — POST user/delete/self', () => {
  const stylist = (version: number) =>
    makeCurrentUserOutput(
      makeStylistCurrentUser({ user: { delete_confirm_version: version } })
    );

  beforeEach(() => {
    __setPermission(true);
    // Centralna bramka impersonacji w middleware: brak kopii admina = zwykły user.
    mockDb({ impersonationBackup: { findFirst: async () => null } });
  });

  it('powtórka tej samej prośby w oknie → 200 i ten sam event, bez drugiego maila', async () => {
    __setCurrentUser(stylist(0));
    const first = await mockApiHandler(deleteSelfHandler, {
      method: 'POST',
      body: {},
    });
    const second = await mockApiHandler(deleteSelfHandler, {
      method: 'POST',
      body: {},
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.event).toBe(first.event);
    expect(second.data).toEqual(first.data);
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('nowa epoka usunięcia (po reaktywacji) wysyła nowy mail od razu', async () => {
    __setCurrentUser(stylist(0));
    await mockApiHandler(deleteSelfHandler, { method: 'POST', body: {} });
    __setCurrentUser(stylist(1));
    await mockApiHandler(deleteSelfHandler, { method: 'POST', body: {} });
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it('parallel double tap while the provider fails: BOTH get the error, never a false "sent"', async () => {
    __setCurrentUser(stylist(0));
    sent.mockResolvedValueOnce(false);
    const [a, b] = await Promise.all([
      mockApiHandler(deleteSelfHandler, { method: 'POST', body: {} }),
      mockApiHandler(deleteSelfHandler, { method: 'POST', body: {} }),
    ]);
    expect([a.status, b.status]).toEqual([500, 500]);
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('nieudana wysyłka zwalnia slot — ponowienie wysyła mail', async () => {
    __setCurrentUser(stylist(0));
    sent.mockResolvedValueOnce(false);
    const failed = await mockApiHandler(deleteSelfHandler, {
      method: 'POST',
      body: {},
    });
    expect(failed.status).toBe(500);

    const retried = await mockApiHandler(deleteSelfHandler, {
      method: 'POST',
      body: {},
    });
    expect(retried.status).toBe(200);
    expect(sent).toHaveBeenCalledTimes(2);
  });
});
