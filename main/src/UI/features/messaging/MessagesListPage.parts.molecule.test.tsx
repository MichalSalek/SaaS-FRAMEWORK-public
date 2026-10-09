import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { AbstractIntlMessages } from 'next-intl';
import type { MessagingConversationDTO } from '@kernel/models/messaging/messaging.dto';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import plMessages from '../../../locales/pl/common.json';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import {
  ConversationRowMolecule,
  InboxFilterMolecule,
} from './MessagesListPage.parts.molecule';

const messages = plMessages as unknown as AbstractIntlMessages;

describe('InboxFilterMolecule', () => {
  it('checks the visible list by default', () => {
    renderWithProviders(
      <InboxFilterMolecule showHidden={false} onShowHiddenChange={vi.fn()} />,
      { messages }
    );

    expect(screen.getByRole('radio', { name: 'Rozmowy' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Ukryte' })).not.toBeChecked();
  });

  it('checks the hidden list when showing hidden', () => {
    renderWithProviders(
      <InboxFilterMolecule showHidden={true} onShowHiddenChange={vi.fn()} />,
      { messages }
    );

    expect(screen.getByRole('radio', { name: 'Ukryte' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Rozmowy' })).not.toBeChecked();
  });
});

const conversation = (
  over: Partial<MessagingConversationDTO> = {}
): MessagingConversationDTO => ({
  pair_id: 'pair-1',
  status: PairingStatusValue.ACTIVE,
  counterpart_name: 'Paulina Dąbrowska',
  counterpart_avatar_url: null,
  last_message_preview: 'Cześć! Wszystko dobrze, planuję wrócić na wizytę.',
  last_message_at: '2020-09-14T10:00:00.000Z',
  unread_count: 0,
  can_send: true,
  hidden_at: null,
  ...over,
});

const renderRow = (c: MessagingConversationDTO) =>
  renderWithProviders(
    <ConversationRowMolecule
      conversation={c}
      showHidden={false}
      onHide={vi.fn()}
      onRestore={vi.fn()}
      actionPending={false}
    />,
    { messages }
  );

describe('ConversationRowMolecule', () => {
  it('is a link to the thread that names the person and dates an old message', () => {
    renderRow(conversation());

    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toMatch(/^\/app\/messages\/pair-1\/?$/);
    expect(link).toHaveTextContent('Paulina Dąbrowska');
    // Older than this year: the date carries day, month and year, never a bare time.
    expect(link).toHaveTextContent(/14 wrz 2020/);
    expect(link).toHaveTextContent('Cześć! Wszystko dobrze');
  });

  it('names a person whose name the API withheld instead of a generic „Rozmowa”', () => {
    renderRow(conversation({ counterpart_name: '  ' }));

    expect(screen.getByRole('link')).toHaveTextContent('Osoba bez imienia');
    expect(screen.queryByText('Rozmowa')).not.toBeInTheDocument();
  });

  it('announces unread and marks the row', () => {
    const { container } = renderRow(conversation({ unread_count: 2 }));

    expect(screen.getByRole('link')).toHaveTextContent('2 nieprzeczytane');
    expect(container.querySelector('[data-unread="true"]')).not.toBeNull();
  });

  it('offers no menu for a conversation with no messages and says so', () => {
    renderRow(
      conversation({ last_message_at: null, last_message_preview: null })
    );

    expect(screen.queryByRole('button', { name: 'Więcej' })).toBeNull();
    expect(screen.getByRole('link')).toHaveTextContent(
      'Jeszcze nie ma wiadomości'
    );
  });
});
