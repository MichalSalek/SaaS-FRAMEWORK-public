import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import type { AbstractIntlMessages } from 'next-intl';
import pl from '../../../locales/pl/common.json';
import { mswServer } from '../../../test-utils/msw/server';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import {
  useClientCrmNote,
  useUpsertClientCrmNote,
} from '../shared/client-card/hooks/useClientCrmNote';
import { CrmNoteSectionOrganism } from './ClientCardPage.crm-note.organism';
const clientId = 'test-client';
const revisions = [
  '2026-10-22T10:00:00.000Z',
  '2026-10-22T11:00:00.000Z',
  '2026-10-22T12:00:00.000Z',
];
const messages = {
  clientCard: {
    ...pl.clientCard,
    noteConflict: {
      title: 'Note changed',
      description: 'Compare versions',
      stored: 'Stored note',
      draft: 'Your draft',
      empty: 'Empty',
      loading: 'Loading',
      loadError: 'Load failed',
      retryLoad: 'Retry loading',
      useStored: 'Use stored note',
      overwrite: 'Replace stored note with my draft',
    },
  },
  buttons: pl.buttons,
  components: pl.components,
} as unknown as AbstractIntlMessages;
function Harness() {
  const query = useClientCrmNote(clientId, true);
  const save = useUpsertClientCrmNote(clientId);
  return (
    <CrmNoteSectionOrganism
      initialNote={query.data?.note}
      updatedAt={query.data?.updatedAt}
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      isSaving={save.isPending}
      isSaveError={save.isError}
      saveError={save.error}
      isSaveSuccess={save.isSuccess}
      savedNote={save.data}
      resetSave={save.reset}
      fetchCurrent={async () => {
        const result = await query.refetch();
        if (result.isError || result.data === undefined) {
          throw new Error('fetch failed');
        }
        return result.data;
      }}
      isDeleting={false}
      isDeleteError={false}
      onDelete={() => {}}
      onSave={(note, expectedUpdatedAt, exactRevision) =>
        save.mutate({
          note,
          expectedUpdatedAt,
          ...(exactRevision ? { exactRevision: true } : {}),
        })
      }
    />
  );
}
describe('CRM conflict against the real mutation hook', () => {
  it('keeps the draft and compares again if the saved note changes after comparison', async () => {
    let current = { note: 'initial', updatedAt: revisions[0] };
    const sent: Array<Record<string, unknown>> = [];
    const response = (data: unknown) =>
      HttpResponse.json({ event: 'APPLICATION_SUCCESS', data });
    mswServer.use(
      http.get('*/api/v1/client/crm-note/get', () => response(current)),
      http.post('*/api/v1/client/crm-note/upsert', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        sent.push(body);
        if (body.expected_updated_at !== current.updatedAt) {
          return HttpResponse.json(
            {
              event: 'VALIDATION_FAILED',
              data: {
                field: 'note',
                message: 'validation.visit.crmNoteChanged',
              },
            },
            { status: 400 }
          );
        }
        current = {
          note: String(body.note),
          updatedAt: '2026-10-22T13:00:00.000Z',
        };
        return response(current);
      })
    );
    renderWithProviders(<Harness />, { messages });
    const field = await screen.findByRole('textbox', {
      name: pl.clientCard.notePlaceholder,
    });
    await waitFor(() => expect(field).toHaveValue('initial'));
    fireEvent.change(field, { target: { value: 'my draft' } });
    current = { note: 'other note', updatedAt: revisions[1] };
    fireEvent.blur(field);
    await screen.findByText('other note');
    expect(field).toHaveValue('my draft');
    current = { note: 'newer note', updatedAt: revisions[2] };
    fireEvent.click(
      screen.getByRole('button', { name: 'Replace stored note with my draft' })
    );
    await screen.findByText('newer note');
    expect(sent.map(item => item.expected_updated_at)).toEqual([
      revisions[0],
      revisions[1],
    ]);
    expect(field).toHaveValue('my draft');
    fireEvent.click(
      screen.getByRole('button', { name: 'Replace stored note with my draft' })
    );
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[2]).toMatchObject({
      note: 'my draft',
      expected_updated_at: revisions[2],
    });
    await waitFor(() => expect(current.note).toBe('my draft'));
  });
});
