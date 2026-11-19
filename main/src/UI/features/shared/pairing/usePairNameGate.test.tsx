import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePairNameGate, shouldPersistPairName } from './usePairNameGate';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
const mutateName = vi.hoisted(() =>
  vi.fn((_input, options) => options.onSuccess())
);
vi.mock('../../account/hooks/useChangeName', () => ({
  useChangeName: () => ({
    mutate: mutateName,
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

function OpenRequest({
  send,
  savedName = '',
  profileName = 'Paznokcie Kraków',
  confirm = true,
}: {
  send: () => void;
  savedName?: string;
  profileName?: string;
  confirm?: boolean;
}) {
  const gate = usePairNameGate(savedName, {
    ownStylistDisplayName: profileName,
    ...(confirm
      ? { confirmation: { stylistName: 'Ola Nails', stylistAvatarUrl: null } }
      : {}),
  });
  return (
    <>
      <button onClick={() => gate.run(send)}>Open</button>
      {gate.dialog}
    </>
  );
}

describe('usePairNameGate', () => {
  it('keeps a saved name ahead of the stylist profile suggestion', async () => {
    render(<OpenRequest send={vi.fn()} savedName='Marta Nowak' />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByLabelText('nameLabel')).toHaveValue(
      'Marta Nowak'
    );
  });

  it('offers the same suggestion in the QR gate and waits for confirmation', async () => {
    const send = vi.fn();
    render(<OpenRequest send={send} confirm={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByLabelText('label')).toHaveValue('Paznokcie');
    expect(send).not.toHaveBeenCalled();
  });
  it('prefills from the client’s own stylist profile and saves the edited name on send', async () => {
    mutateName.mockClear();
    const send = vi.fn();
    render(<OpenRequest send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const input = await screen.findByLabelText('nameLabel');
    expect(input).toHaveValue('Paznokcie');
    expect(mutateName).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Anna' } });
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ note: null }));
    expect(mutateName).toHaveBeenCalledWith(
      { name: 'Anna' },
      expect.anything()
    );
  });
  it('sends at once when she already has a name', () => {
    const send = vi.fn();
    const { result } = renderHook(() => usePairNameGate('Marta'));
    act(() => result.current.run(send));
    expect(send).toHaveBeenCalledOnce();
  });

  it('holds the request when the name is missing or blank', () => {
    const send = vi.fn();
    const { result } = renderHook(() => usePairNameGate('  '));
    act(() => result.current.run(send));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.isOpen).toBe(true);
  });

  it('opens the confirmation dialog even when the name is already set', () => {
    const send = vi.fn();
    const { result } = renderHook(() =>
      usePairNameGate('Marta', {
        confirmation: { stylistName: 'Ola Nails', stylistAvatarUrl: null },
      })
    );
    act(() => result.current.run(send));
    expect(send).not.toHaveBeenCalled();
    expect(result.current.isOpen).toBe(true);
  });

  it('saves the name only when it changed', () => {
    expect(shouldPersistPairName('Marta', 'Marta')).toBe(false);
    expect(shouldPersistPairName('Marta', '  Marta  ')).toBe(false);
    expect(shouldPersistPairName('Marta', 'Anna')).toBe(true);
    expect(shouldPersistPairName('  ', 'Anna')).toBe(true);
  });
});
