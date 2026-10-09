// NavigationContentShell — incoming-marker lifecycle (NVT adversarial A3).
// The marker gates the exit keyframes (CSS :not([data-nav-incoming])); a
// lingering marker would block the exit animation of a rapid follow-up tap.

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useNavigationStore } from '../../application/stores/navigation.store';
import { NavigationContentShellComposition } from './NavigationContentShell.composition';

const store = useNavigationStore;

function begin(targetPathname: string | null = '/app/gallery'): number {
  return store.getState().beginTransition({
    policy: 'slide',
    direction: 'forward',
    scrollMode: 'reset',
    scrollModeExplicit: false,
    skipFocus: false,
    targetPathname,
    hookDriven: false,
  });
}

function shellEl(): HTMLElement {
  return screen.getByText('page-content').parentElement as HTMLElement;
}

beforeEach(() => {
  store.setState(store.getInitialState(), true);
});

describe('NavigationContentShell — data-nav-incoming', () => {
  it('mounted while idle → no incoming marker (current content)', () => {
    render(
      <NavigationContentShellComposition>
        <span>page-content</span>
      </NavigationContentShellComposition>
    );
    expect(shellEl().hasAttribute('data-nav-incoming')).toBe(false);
  });

  it('mounted mid-transition → incoming; dropped when the FSM settles', () => {
    const id = begin();
    render(
      <NavigationContentShellComposition>
        <span>page-content</span>
      </NavigationContentShellComposition>
    );
    expect(shellEl().hasAttribute('data-nav-incoming')).toBe(true);

    act(() => {
      store.getState().markExitDone(id);
      store.getState().markRouteReady(id);
      store.getState().markEnterDone(id);
    });
    expect(store.getState().phase).toBe('idle');
    expect(shellEl().hasAttribute('data-nav-incoming')).toBe(false);
  });

  it('A3: dropped when a NEWER transition begins (rapid tap during entering)', () => {
    const id = begin();
    render(
      <NavigationContentShellComposition>
        <span>page-content</span>
      </NavigationContentShellComposition>
    );
    act(() => {
      store.getState().markExitDone(id);
      store.getState().markRouteReady(id);
    });
    expect(store.getState().phase).toBe('entering');
    expect(shellEl().hasAttribute('data-nav-incoming')).toBe(true);

    // Tap during entering: a new transition begins — phase never touches
    // idle, only the transitionId bumps. THIS shell is now the exiting one.
    act(() => {
      begin('/app/pairing');
    });
    expect(store.getState().phase).toBe('exiting');
    expect(shellEl().hasAttribute('data-nav-incoming')).toBe(false);
  });

  it('unmount during exiting reports exitDone for the active transition', () => {
    const view = render(
      <NavigationContentShellComposition>
        <span>page-content</span>
      </NavigationContentShellComposition>
    );
    const id = begin();
    view.unmount();
    expect(store.getState().exitDone).toBe(true);
    expect(store.getState().transitionId).toBe(id);
  });
});
