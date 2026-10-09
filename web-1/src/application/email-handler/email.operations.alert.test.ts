import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  sendLifecycleEmail: vi.fn(async () => true),
}));

vi.mock('./email-transport', () => ({
  sendLifecycleEmail: transport.sendLifecycleEmail,
}));
vi.mock('@app/admin/admin.utils.api', () => ({
  getPrimaryAdminEmail: () => 'owner@example.test',
}));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: vi.fn(),
}));

import { sendCriticalBusinessAlert } from './email.operations';
import { validateAlertParams } from './email.utils';

type SentMail = { subject: string; html: string; text: string };
const lastMail = (): SentMail =>
  (transport.sendLifecycleEmail.mock.calls.at(-1) as unknown as [SentMail])[0];

describe('sendCriticalBusinessAlert', () => {
  beforeEach(() => {
    transport.sendLifecycleEmail.mockClear();
  });

  it('sends a Polish mail with the readable list above the details', async () => {
    await sendCriticalBusinessAlert({
      alertTitle: 'Nowe rejestracje z ostatniej doby',
      alertMessage: 'Rejestracje: 1.',
      lines: ['anna@example.test (onboarding nieukończony), 23.09, 13:04'],
      details: { count: 1 },
    });
    const mail = lastMail();
    expect(mail.subject).toBe('[Nailfolio] Nowe rejestracje z ostatniej doby');
    expect(mail.html).toContain('lang="pl"');
    expect(mail.html).toContain(
      '<li style="font-size:16px;line-height:24px;color:#7F1D1D;margin:0 0 4px;">anna@example.test (onboarding nieukończony), 23.09, 13:04</li>'
    );
    expect(mail.html).toContain('Szczegóły techniczne');
    expect(mail.text).toContain(
      '• anna@example.test (onboarding nieukończony), 23.09, 13:04'
    );
    expect(mail.html.indexOf('<ul')).toBeLessThan(
      mail.html.indexOf('Szczegóły techniczne')
    );
  });

  it('escapes list entries and keeps a literal $ from the data', async () => {
    await sendCriticalBusinessAlert({
      alertTitle: 'Test',
      alertMessage: 'Kwota $& i $1 zostaje dosłownie.',
      lines: ['<script>x</script> $&'],
      details: {},
    });
    const mail = lastMail();
    expect(mail.html).toContain('&lt;script&gt;x&lt;/script&gt; $&amp;');
    expect(mail.html).not.toContain('<script>');
    expect(mail.text).toContain('Kwota $& i $1 zostaje dosłownie.');
  });

  it('renders no list when there are no lines', async () => {
    await sendCriticalBusinessAlert({
      alertTitle: 'Test',
      alertMessage: 'Bez listy.',
      details: {},
    });
    expect(lastMail().html).not.toContain('<ul');
  });
});

describe('validateAlertParams lines', () => {
  it('trims, drops empty entries and caps the list', () => {
    const { lines } = validateAlertParams({
      alertTitle: 't',
      alertMessage: 'm',
      lines: ['  a  ', '', ...Array.from({ length: 120 }, (_, i) => `x${i}`)],
      details: {},
    });
    expect(lines[0]).toBe('a');
    expect(lines).not.toContain('');
    expect(lines.length).toBeLessThanOrEqual(100);
  });
});

describe('alert action link', () => {
  beforeEach(() => {
    transport.sendLifecycleEmail.mockClear();
  });

  it('renders an http(s) link in both versions, escaped', async () => {
    await sendCriticalBusinessAlert({
      alertTitle: 'Test',
      alertMessage: 'Z linkiem.',
      link: {
        label: 'Otwórz <kartę>',
        url: 'https://nailfolio.app/app/admin/users?q=a&user=b',
      },
      details: {},
    });
    const mail = lastMail();
    expect(mail.html).toContain(
      'href="https://nailfolio.app/app/admin/users?q=a&amp;user=b"'
    );
    expect(mail.html).toContain('Otwórz &lt;kartę&gt;');
    expect(mail.text).toContain(
      'Otwórz <kartę>: https://nailfolio.app/app/admin/users?q=a&user=b'
    );
  });

  it('drops a non-http link and still sends the alert', async () => {
    await sendCriticalBusinessAlert({
      alertTitle: 'Test',
      alertMessage: 'Bez linku.',
      link: { label: 'Kliknij', url: 'javascript:alert(1)' },
      details: {},
    });
    const mail = lastMail();
    expect(mail.html).not.toContain('javascript:');
    expect(mail.html).not.toContain('Kliknij');
  });
});
