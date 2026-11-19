// „Ważne przed wizytą” on the client card: the field adopts the stored note, saves itself on
// blur (and on Enter) with the typed text, never offers an editor while the stored value is
// unknown, and clamps to the server cap by code points.

import { describe, expect, it } from 'vitest';
import { useLayoutEffect } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { AbstractIntlMessages } from 'next-intl';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import plMessages from '../../../locales/pl/common.json';
import {
  makeTestQueryClient,
  renderWithProviders,
} from '../../../test-utils/renderWithProviders';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { mswServer } from '../../../test-utils/msw/server';
import {
  clampImportantNote,
  ImportantNoteSectionOrganism,
} from './ClientCardPage.important-note.organism';

const messages = {
  clientCard: {
    ...plMessages.clientCard,
    noteConflict: {
      title: 'Note changed',
      stored: 'Stored note',
      draft: 'Your draft',
      empty: 'Empty',
      loading: 'Loading current note',
      loadError: 'Could not load current note',
      retryLoad: 'Retry loading',
      useStored: 'Use stored note',
      overwrite: 'Replace stored note with my draft',
    },
  },
  buttons: plMessages.buttons,
  components: plMessages.components,
} as unknown as AbstractIntlMessages;

const FIELD = plMessages.clientCard.importantNoteTitle;
const CLIENT = 'usr_client_1';

const envelope = (data: unknown) =>
  HttpResponse.json({ event: 'APPLICATION_SUCCESS', data });

const renderSection = () =>
  renderWithProviders(<ImportantNoteSectionOrganism clientUserId={CLIENT} />, {
    messages,
  });

describe('ImportantNoteSectionOrganism', () => {
  it('adopts the stored note and saves the edit on blur', async () => {
    const bodies: unknown[] = [];
    mswServer.use(
      http.get('*/api/v1/client/important-note/get', () =>
        envelope({ note: 'Uczulenie na aceton', updatedAt: null })
      ),
      http.post(
        '*/api/v1/client/important-note/upsert',
        async ({ request }) => {
          const body = (await request.json()) as { note: string };
          bodies.push(body);
          return envelope({
            note: body.note,
            updatedAt: '2026-10-22T10:00:00Z',
          });
        }
      )
    );
    renderSection();

    const field = await screen.findByRole('textbox', { name: FIELD });
    await waitFor(() => expect(field).toHaveValue('Uczulenie na aceton'));

    fireEvent.change(field, { target: { value: 'Uczulenie na lateks' } });
    fireEvent.blur(field);

    await waitFor(() =>
      expect(bodies).toEqual([
        {
          client_user_id: CLIENT,
          note: 'Uczulenie na lateks',
          expected_updated_at: null,
        },
      ])
    );
  });

  it('adopts an untouched refetch without saving, but keeps a dirty draft on conflict', async () => {
    const posts: Array<Record<string, unknown>> = [];
    const first = '2026-10-22T10:00:00.000Z',
      second = '2026-10-22T11:00:00.000Z';
    mswServer.use(
      http.get('*/api/v1/client/important-note/get', () =>
        envelope({ note: 'first', updatedAt: first })
      ),
      http.post(
        '*/api/v1/client/important-note/upsert',
        async ({ request }) => {
          posts.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json(
            { event: 'GENERAL_ERROR', data: null },
            { status: 409 }
          );
        }
      )
    );
    const { queryClient } = renderSection();
    const field = await screen.findByRole('textbox', { name: FIELD });
    await waitFor(() => expect(field).toHaveValue('first'));
    act(() => {
      queryClient.setQueryData(queryKeys.client.importantNote(CLIENT), {
        note: 'external',
        updatedAt: second,
      });
    });
    await waitFor(() => expect(field).toHaveValue('external'));
    fireEvent.blur(field);
    expect(posts).toHaveLength(0);
    fireEvent.change(field, { target: { value: 'my draft' } });
    act(() => {
      queryClient.setQueryData(queryKeys.client.importantNote(CLIENT), {
        note: 'external again',
        updatedAt: '2026-10-22T12:00:00.000Z',
      });
    });
    fireEvent.blur(field);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      note: 'my draft',
      expected_updated_at: second,
    });
    expect(field).toHaveValue('my draft');
  });

  it('preserves an edit made after commit but before the pending server adoption effect', async () => {
    const first = '2026-10-22T10:00:00.000Z';
    const posts: Array<Record<string, unknown>> = [];
    mswServer.use(
      http.post(
        '*/api/v1/client/important-note/upsert',
        async ({ request }) => {
          posts.push((await request.json()) as Record<string, unknown>);
          return envelope({
            note: 'my draft',
            updatedAt: '2026-10-22T11:00:00.000Z',
          });
        }
      )
    );
    const queryClient = makeTestQueryClient();
    queryClient.setQueryData(queryKeys.client.importantNote(CLIENT), {
      note: 'first',
      updatedAt: first,
    });
    function EditBeforePassiveEffects() {
      useLayoutEffect(() => {
        const input = screen.getByRole('textbox', { name: FIELD });
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )?.set;
        setter?.call(input, 'my draft');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, []);
      return <ImportantNoteSectionOrganism clientUserId={CLIENT} />;
    }
    renderWithProviders(<EditBeforePassiveEffects />, {
      messages,
      queryClient,
    });
    const field = screen.getByRole('textbox', { name: FIELD });
    expect(field).toHaveValue('my draft');
    fireEvent.blur(field);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      note: 'my draft',
      expected_updated_at: first,
    });
  });

  it('preserves a keystroke when a refetch notification and edit overlap', async () => {
    const first = '2026-10-22T10:00:00.000Z';
    const second = '2026-10-22T11:00:00.000Z';
    const posts: Array<Record<string, unknown>> = [];
    mswServer.use(
      http.get('*/api/v1/client/important-note/get', () =>
        envelope({ note: 'first', updatedAt: first })
      ),
      http.post(
        '*/api/v1/client/important-note/upsert',
        async ({ request }) => {
          posts.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json(
            { event: 'GENERAL_ERROR', data: null },
            { status: 409 }
          );
        }
      )
    );
    const { queryClient } = renderSection();
    const field = await screen.findByRole('textbox', { name: FIELD });
    await waitFor(() => expect(field).toHaveValue('first'));
    act(() => {
      queryClient.setQueryData(queryKeys.client.importantNote(CLIENT), {
        note: 'external',
        updatedAt: second,
      });
      fireEvent.change(field, { target: { value: 'my draft' } });
    });
    fireEvent.blur(field);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      note: 'my draft',
      expected_updated_at: first,
    });
    expect(field).toHaveValue('my draft');
  });

  it('compares a conflict and overwrites only with the fetched revision', async () => {
    const revisions = [
      '2026-10-22T10:00:00.000Z',
      '2026-10-22T11:00:00.000Z',
      '2026-10-22T12:00:00.000Z',
    ];
    let server = { note: 'initial', updatedAt: revisions[0] };
    const sent: Array<Record<string, unknown>> = [];
    mswServer.use(
      http.get('*/api/v1/client/important-note/get', () => envelope(server)),
      http.post(
        '*/api/v1/client/important-note/upsert',
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          sent.push(body);
          if (body.expected_updated_at !== server.updatedAt) {
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
          server = {
            note: String(body.note),
            updatedAt: '2026-10-22T13:00:00.000Z',
          };
          return envelope(server);
        }
      )
    );
    renderSection();
    const field = await screen.findByRole('textbox', { name: FIELD });
    await waitFor(() => expect(field).toHaveValue('initial'));
    fireEvent.change(field, { target: { value: 'my draft' } });
    server = { note: 'other change', updatedAt: revisions[1] };
    fireEvent.blur(field);
    await screen.findByText('other change');
    expect(field).toHaveValue('my draft');
    expect(sent).toHaveLength(1);
    server = { note: 'newer change', updatedAt: revisions[2] };
    fireEvent.click(
      screen.getByRole('button', { name: 'Replace stored note with my draft' })
    );
    await screen.findByText('newer change');
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
    await waitFor(() => expect(server.note).toBe('my draft'));
    expect(field).toHaveValue('my draft');
  });

  it('can discard the draft and use the compared stored note without a write', async () => {
    let server = { note: 'initial', updatedAt: '2026-10-22T10:00:00.000Z' };
    const sent: unknown[] = [];
    mswServer.use(
      http.get('*/api/v1/client/important-note/get', () => envelope(server)),
      http.post(
        '*/api/v1/client/important-note/upsert',
        async ({ request }) => {
          sent.push(await request.json());
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
      )
    );
    renderSection();
    const field = await screen.findByRole('textbox', { name: FIELD });
    await waitFor(() => expect(field).toHaveValue('initial'));
    fireEvent.change(field, { target: { value: 'my draft' } });
    server = { note: 'other note', updatedAt: '2026-10-22T11:00:00.000Z' };
    fireEvent.blur(field);
    await screen.findByText('other note');
    fireEvent.click(screen.getByRole('button', { name: 'Use stored note' }));
    expect(field).toHaveValue('other note');
    fireEvent.blur(field);
    expect(sent).toHaveLength(1);
  });

  it('a blur without a change sends nothing', async () => {
    let posts = 0;
    mswServer.use(
      http.get('*/api/v1/client/important-note/get', () =>
        envelope({ note: null, updatedAt: null })
      ),
      http.post('*/api/v1/client/important-note/upsert', () => {
        posts += 1;
        return envelope({ note: null, updatedAt: null });
      })
    );
    renderSection();

    const field = await screen.findByRole('textbox', { name: FIELD });
    expect(field).toHaveAttribute(
      'placeholder',
      plMessages.clientCard.importantNotePlaceholder
    );
    fireEvent.blur(field);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(posts).toBe(0);
  });

  it('no editor while the stored note is unknown (load error)', async () => {
    mswServer.use(
      http.get('*/api/v1/client/important-note/get', () =>
        HttpResponse.json(
          { event: 'DATABASE_ERROR', data: null },
          { status: 500 }
        )
      )
    );
    renderSection();

    await screen.findByText(plMessages.clientCard.importantNoteLoadError);
    expect(screen.queryByRole('textbox', { name: FIELD })).toBeNull();
  });
});

describe('clampImportantNote', () => {
  it('cuts at IMPORTANT_NOTE_MAX code points and folds line breaks', () => {
    const emoji = '😀';
    expect(
      clampImportantNote(emoji.repeat(VISIT_CONFIG.IMPORTANT_NOTE_MAX + 5))
    ).toBe(emoji.repeat(VISIT_CONFIG.IMPORTANT_NOTE_MAX));
    expect(clampImportantNote('aceton\nlateks')).toBe('aceton lateks');
  });
});
