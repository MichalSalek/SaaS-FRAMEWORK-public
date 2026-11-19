import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { useNavigationStore } from '../../../../application/stores/navigation.store';
import { useContactComposerFocus } from './useContactComposerFocus';

const route = vi.hoisted(() => ({
  query: { pairId: 'one', focus: '1' } as Record<string, string>,
  pathname: '/app/messages/[pairId]',
  replace: vi.fn(async () => true),
}));
vi.mock('next/router', () => ({ useRouter: () => route }));
function Thread({ pairId, canSend }: { pairId: string; canSend: boolean }) {
  const input = useRef<HTMLTextAreaElement>(null);
  useContactComposerFocus(pairId, canSend, input);
  return (
    <>
      <main tabIndex={-1} data-testid='main' />
      <textarea aria-label='message' ref={input} />
    </>
  );
}
beforeEach(() => {
  useNavigationStore.setState(useNavigationStore.getInitialState(), true);
  route.query = { pairId: 'one', focus: '1' };
  route.replace.mockClear();
});
afterEach(() =>
  useNavigationStore.setState(useNavigationStore.getInitialState(), true)
);

describe('contact composer focus', () => {
  it('waits for transition settle, focuses once, and does not steal focus on a poll rerender', () => {
    useNavigationStore.setState({ phase: 'entering' });
    const view = render(<Thread pairId='one' canSend />);
    const input = screen.getByRole('textbox');
    const main = screen.getByTestId('main');
    expect(document.activeElement).not.toBe(input);
    act(() => {
      main.focus();
      useNavigationStore.setState({ phase: 'idle' });
    });
    expect(document.activeElement).toBe(input);
    expect(route.replace).toHaveBeenCalledOnce();
    act(() => main.focus());
    view.rerender(<Thread pairId='one' canSend />);
    expect(document.activeElement).toBe(main);
    expect(route.replace).toHaveBeenCalledOnce();
  });
  it('waits until sending is allowed and supports a new target', () => {
    const view = render(<Thread pairId='one' canSend={false} />);
    const input = screen.getByRole('textbox');
    expect(document.activeElement).not.toBe(input);
    view.rerender(<Thread pairId='one' canSend />);
    expect(document.activeElement).toBe(input);
    act(() => screen.getByTestId('main').focus());
    route.query = { pairId: 'two', focus: '1' };
    view.rerender(<Thread pairId='two' canSend />);
    expect(document.activeElement).toBe(input);
    expect(route.replace).toHaveBeenCalledTimes(2);
  });
});
