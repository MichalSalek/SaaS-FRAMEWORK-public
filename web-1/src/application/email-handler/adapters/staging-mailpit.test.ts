import { beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({
  host: 'mailpit',
  port: '1025',
  mode: 'STAGING',
  send: vi.fn(),
  create: vi.fn(),
}));
vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: {
    get NODE_ENV_MANUAL() {
      return io.mode;
    },
    get MAILPIT_HOST() {
      return io.host;
    },
    get MAILPIT_PORT() {
      return io.port;
    },
  },
}));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: io.create.mockImplementation(() => ({
      sendMail: io.send,
    })),
  },
}));
import { sendStagingMailpit } from './staging-mailpit';
const params = {
  to: 'client@example.test',
  subject: 'Test',
  html: '<p>test</p>',
};
beforeEach(() => {
  io.host = 'mailpit';
  io.port = '1025';
  io.mode = 'STAGING';
  io.send.mockReset();
  io.create.mockClear();
});
describe('Mailpit adapter', () => {
  it('sends to the internal uncredentialed SMTP service and requires acceptance', async () => {
    io.send.mockResolvedValue({
      messageId: '<id>',
      accepted: [params.to],
      rejected: [],
    });
    expect(await sendStagingMailpit(params)).toBe('<id>');
    expect(io.create).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'mailpit', port: 1025, secure: false })
    );
    expect(io.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: params.to, html: params.html })
    );
  });
  it('rejects malformed sink configuration and missing SMTP acceptance', async () => {
    io.host = 'external.example.test';
    await expect(sendStagingMailpit(params)).rejects.toThrow('invalid');
    expect(io.send).not.toHaveBeenCalled();
    io.host = 'mailpit';
    io.send.mockResolvedValue({
      messageId: '<id>',
      accepted: [],
      rejected: [params.to],
    });
    await expect(sendStagingMailpit(params)).rejects.toThrow('did not accept');
  });
});
