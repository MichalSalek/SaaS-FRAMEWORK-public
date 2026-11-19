import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  PairRequestConfirmDialogMolecule,
  emptyToNull,
} from './PairRequestConfirmDialog.molecule';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

function Harness({
  send = vi.fn(),
  cancel = vi.fn(),
}: {
  send?: (value: { note: string | null }) => void;
  cancel?: () => void;
}) {
  const [name, setName] = useState('Marta');
  const [note, setNote] = useState('');
  return (
    <PairRequestConfirmDialogMolecule
      stylistName='Ola'
      stylistAvatarUrl={null}
      name={name}
      onNameChange={setName}
      note={note}
      onNoteChange={setNote}
      nameError={null}
      saving={false}
      submitDisabled={false}
      onCancel={cancel}
      onSubmit={() => send({ note: emptyToNull(note) })}
    />
  );
}

describe('PairRequestConfirmDialog', () => {
  it('shows the encouraging outcome and the optional message, without a location control', () => {
    render(<Harness />);
    expect(screen.getByText('benefit')).toBeInTheDocument();
    expect(screen.getByLabelText('noteLabel')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'useLocation' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('locationAttribution')).not.toBeInTheDocument();
    expect(screen.queryByText('dataNote')).not.toBeInTheDocument();
  });

  it('sends the note and trims blank input to null', () => {
    const send = vi.fn();
    render(<Harness send={send} />);
    fireEvent.change(screen.getByLabelText('noteLabel'), {
      target: { value: '  do zobaczenia w czwartek  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));
    expect(send).toHaveBeenCalledWith({ note: 'do zobaczenia w czwartek' });
  });

  it('sends null when the optional message is blank', () => {
    const send = vi.fn();
    render(<Harness send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));
    expect(send).toHaveBeenCalledWith({ note: null });
  });

  it('cancels without sending', () => {
    const send = vi.fn();
    const cancel = vi.fn();
    render(<Harness send={send} cancel={cancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });
});
