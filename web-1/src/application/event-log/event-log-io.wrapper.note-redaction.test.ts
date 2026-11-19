import { expect, it, vi } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
const { write, report } = vi.hoisted(() => ({
  write: vi.fn(async (_args: unknown) => undefined),
  report: vi.fn(),
}));
vi.mock('./event-log.client', () => ({ writeRawEventLog_IO: write }));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: report }));
vi.mock('@domain/user/user.utils.api', () => ({
  fillUserMetadataWithLocation: async () => ({}),
}));
import { recordAuditEvent_IO } from './event-log-io.wrapper';
it('drops singular and compound note fields from request and response without logging their values', async () => {
  await recordAuditEvent_IO({
    eventName: APP_EVENTS.INFO.USER.USER_NAME_CHANGED,
    user: { id: 'user-1' },
    requestBody: {
      note: 'private allergy',
      important_note: 'private safety',
      pair_id: 'pair-1',
      has_note: true,
    },
    responseBody: {
      crmNote: 'private draft',
      client_notes: 'private history',
      updatedAt: 'revision-1',
    },
  });
  expect(write).toHaveBeenCalledOnce();
  const written = write.mock.calls[0]?.[0] as {
    eventPayloadToStringify: unknown;
  };
  expect(written.eventPayloadToStringify).toMatchObject({
    requestBody: { pair_id: 'pair-1', has_note: true },
    responseBody: { updatedAt: 'revision-1' },
  });
  expect(JSON.stringify(written.eventPayloadToStringify)).not.toContain(
    'private'
  );
  expect(JSON.stringify(report.mock.calls)).not.toContain('private');
});
