import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppModalShellAtom } from './AppModalShell.atom';

describe('AppModalShell inactive panel accessibility', () => {
  it('keeps a mounted closed panel out of the accessibility tree and keyboard navigation', () => {
    render(
      <AppModalShellAtom variant='fullscreen' active={false} label='Filters'>
        <button type='button'>Clear</button>
      </AppModalShellAtom>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Clear' })
    ).not.toBeInTheDocument();
    const panel = screen.getByRole('dialog', { hidden: true });
    expect(panel).toHaveAttribute('inert');
    expect(panel).not.toHaveAttribute('aria-modal');
  });

  it('exposes the open panel, closes on Escape and restores trigger focus', async () => {
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.append(trigger);
    trigger.focus();
    const view = render(
      <AppModalShellAtom
        variant='fullscreen'
        active
        label='Filters'
        initialFocus='container'
        onClose={onClose}>
        <button type='button'>Clear</button>
      </AppModalShellAtom>
    );
    const panel = screen.getByRole('dialog', { name: 'Filters' });
    await waitFor(() => expect(panel).toHaveFocus());
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(panel).not.toHaveAttribute('inert');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    view.rerender(
      <AppModalShellAtom
        variant='fullscreen'
        active={false}
        label='Filters'
        initialFocus='container'
        onClose={onClose}>
        <button type='button'>Clear</button>
      </AppModalShellAtom>
    );
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.unmount();
    trigger.remove();
  });
});
