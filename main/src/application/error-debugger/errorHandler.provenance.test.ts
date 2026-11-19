import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportIssueFrontend } from './errorHandler.possibilities.api';
import { sendEventLogBeacon_IO } from './errorHandlerIO.possibilities.api';

vi.mock('./errorHandlerIO.possibilities.api', () => ({
  sendEventLogBeacon_IO: vi.fn(),
}));
vi.mock('../environment/environment.possibilities.api', () => ({
  getEnvironmentMode: () => 'PRODUCTION',
  IS_DEVELOPMENT_ENV: () => false,
}));
vi.mock('../http/queryClient.config', () => ({
  queryClient: { getQueryData: () => undefined },
}));

const send = vi.mocked(sendEventLogBeacon_IO);
beforeEach(() => {
  send.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  document.getElementById('__NEXT_DATA__')?.remove();
});

describe('client log provenance', () => {
  it('persists browser agent, language and the document build for every reporting path', () => {
    const script = document.createElement('script');
    script.id = '__NEXT_DATA__';
    script.type = 'application/json';
    script.textContent = '{"buildId":"production-build-123"}';
    document.head.appendChild(script);
    reportIssueFrontend({
      namespace: 'ErrorBoundary',
      message: 'Unhandled React render error',
      payload: { stack: 'test stack' },
      mode: 'error',
    });
    expect(send).toHaveBeenCalledTimes(1);
    const metadata: unknown = JSON.parse(
      send.mock.calls[0]?.[0].user_metadata ?? '{}'
    );
    expect(metadata).toMatchObject({
      user_agent: navigator.userAgent,
      language: navigator.language,
      buildId: 'production-build-123',
    });
  });

  it('continues reporting when document build metadata is missing', () => {
    reportIssueFrontend({
      namespace: 'window.error',
      message: 'Maximum call stack size exceeded',
      payload: null,
      mode: 'error',
    });
    expect(send).toHaveBeenCalledTimes(1);
    const metadata: unknown = JSON.parse(
      send.mock.calls[0]?.[0].user_metadata ?? '{}'
    );
    expect(metadata).toMatchObject({
      user_agent: navigator.userAgent,
      buildId: null,
    });
  });

  it('keeps credential redaction while enriching the report', () => {
    reportIssueFrontend({
      namespace: 'caught-error',
      message: 'A real error',
      payload: { token: 'credential', nested: { password: 'secret' } },
      mode: 'error',
    });
    expect(send.mock.calls[0]?.[0].payload).not.toContain('credential');
    expect(send.mock.calls[0]?.[0].payload).not.toContain('secret');
    expect(send.mock.calls[0]?.[0].payload).toContain('[REDACTED]');
  });
  it('redacts private note text before sending diagnostic reports', () => {
    reportIssueFrontend({
      namespace: 'onCatchMainInterceptor',
      message: 'HTTP ERROR 400',
      payload: {
        event: 'VALIDATION_FAILED',
        data: { field: 'note', message: 'validation.visit.crmNoteChanged' },
        request: {
          note: 'sensitive allergy text',
          crm_note: 'private CRM',
          importantNote: 'private warning',
        },
      },
      mode: 'error',
    });
    const payload = send.mock.calls[0]?.[0].payload ?? '';
    expect(payload).not.toContain('sensitive allergy text');
    expect(payload).not.toContain('private CRM');
    expect(payload).not.toContain('private warning');
    expect(payload).toContain('validation.visit.crmNoteChanged');
    expect(payload).toContain('[REDACTED]');
  });
  it('retains non-enumerable error diagnostics while redacting its private fields', () => {
    const error = Object.assign(
      new Error('request failed for a known reason'),
      {
        note: 'private allergy',
        token: 'private credential',
      }
    );
    reportIssueFrontend({
      namespace: 'caught-error-object',
      message: 'Caught error',
      payload: { error },
      mode: 'error',
    });
    const payload = send.mock.calls[0]?.[0].payload ?? '';
    expect(payload).toContain('request failed for a known reason');
    expect(payload).toContain('stack');
    expect(payload).not.toContain('private allergy');
    expect(payload).not.toContain('private credential');
  });
});
