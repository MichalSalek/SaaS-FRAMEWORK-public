/**
 * The Resend send is bounded (testy-api s34 review): without a signal the SDK's
 * bare fetch could hold a send, the retry cascade and every deduped duplicate
 * click for Node's multi-minute default.
 */
import { describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(async (_payload: unknown, _options: unknown) => ({
    data: { id: 'em_1' },
    error: null,
  })),
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));
vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: { RESEND_API_KEY: 're_test' },
}));
vi.mock('@app/email-handler/email-dev-sink', () => ({
  shouldStubEmailSend: () => false,
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import { sendEmail } from './resend';

describe('Resend adapter', () => {
  it('passes an AbortSignal (bounded send)', async () => {
    await sendEmail({ to: 'a@example.com', subject: 'x', html: '<p>x</p>' });
    const options = sendMock.mock.calls[0]?.[1] as { signal: AbortSignal };
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal.aborted).toBe(false);
  });
});
