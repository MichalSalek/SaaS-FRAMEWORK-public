import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavigationStore } from '../../../../application/stores/navigation.store';
import { StylistBrandColorFieldOrganism } from './StylistBrandColorField.organism';
import { NavigationTransitionControllerComposition } from '../../../layouts/NavigationTransitionController.composition';

const nav = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const events = {
    on: (name: string, fn: (...args: unknown[]) => void) => {
      const listeners = handlers.get(name) ?? new Set();
      listeners.add(fn);
      handlers.set(name, listeners);
    },
    off: (name: string, fn: (...args: unknown[]) => void) =>
      handlers.get(name)?.delete(fn),
    emit: (name: string, ...args: unknown[]) =>
      handlers.get(name)?.forEach(fn => fn(...args)),
  };
  return {
    router: {
      events,
      asPath: '/app/checkout/return',
      pathname: '/app/checkout/return',
      beforePopState: vi.fn(),
      back: vi.fn(),
      push: vi.fn(),
    },
    events,
  };
});
vi.mock('next/router', () => ({ useRouter: () => nav.router }));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../../shared/upsell/usePurchaseResumeCapture', () => ({
  usePurchaseResumeCapture: () => vi.fn(),
}));
vi.mock('../../shared/branding/BrandColorField.molecule', () => ({
  BrandColorFieldMolecule: ({ id }: { id: string }) => <div id={id} />,
}));

let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let scroll: ReturnType<typeof vi.fn>;
const renderField = () =>
  render(
    <StylistBrandColorFieldOrganism
      value=''
      savedValue=''
      canBrand
      isPending={false}
      hasFailed={false}
      onSelect={vi.fn()}
    />
  );
const flushFrame = () => {
  const pending = [...frames.values()];
  frames.clear();
  act(() => {
    pending.forEach(callback => callback(0));
  });
};
beforeEach(() => {
  frames = new Map();
  frameId = 0;
  scroll = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scroll,
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++frameId;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
  useNavigationStore.setState({ phase: 'idle', transitionId: 1 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useNavigationStore.setState({ phase: 'idle' });
  window.history.replaceState(null, '', '/');
});

describe('post-activation brand entry', () => {
  it('runs after the real navigation controller resets the route and completes entry', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const target = '/app/profile?profile=personal#brand-colour';
    window.history.replaceState(null, '', '/app/checkout/return');
    const order: string[] = [];
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {
      order.push('reset');
    });
    scroll.mockImplementation(() => order.push('anchor'));
    render(
      <>
        <NavigationTransitionControllerComposition />
        <main id='main-content'>
          <div data-navigation-content-shell='' />
        </main>
      </>
    );
    act(() => nav.events.emit('routeChangeStart', target, { shallow: false }));
    act(() =>
      useNavigationStore
        .getState()
        .markExitDone(useNavigationStore.getState().transitionId)
    );
    window.history.replaceState(null, '', target);
    renderField();
    expect(scroll).not.toHaveBeenCalled();
    act(() =>
      nav.events.emit('routeChangeComplete', target, { shallow: false })
    );
    expect(useNavigationStore.getState().phase).toBe('entering');
    expect(order).toEqual(['reset']);
    act(() =>
      useNavigationStore
        .getState()
        .markEnterDone(useNavigationStore.getState().transitionId)
    );
    flushFrame();
    expect(order).toEqual(['reset', 'anchor']);
    expect(document.activeElement?.id).toBe('brand-colour');
    vi.useRealTimers();
  });
  it('waits for entering to settle, then scrolls and focuses exactly once after the route reset', () => {
    window.history.replaceState(
      null,
      '',
      '/app/profile?profile=personal#brand-colour'
    );
    useNavigationStore.setState({ phase: 'entering', transitionId: 7 });
    const field = renderField();
    expect(scroll).not.toHaveBeenCalled();
    // NavigationTransitionController resets both scroll owners before marking the route ready.
    const events: string[] = ['route-reset'];
    scroll.mockImplementation(() => events.push('anchor'));
    act(() => useNavigationStore.setState({ phase: 'idle' }));
    expect(scroll).not.toHaveBeenCalled();
    flushFrame();
    expect(events).toEqual(['route-reset', 'anchor']);
    expect(document.activeElement?.id).toBe('brand-colour');
    field.rerender(
      <StylistBrandColorFieldOrganism
        value='#fff'
        savedValue=''
        canBrand
        isPending={false}
        hasFailed={false}
        onSelect={vi.fn()}
      />
    );
    act(() =>
      useNavigationStore.setState({ phase: 'entering', transitionId: 8 })
    );
    act(() => useNavigationStore.setState({ phase: 'idle' }));
    flushFrame();
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('scrolls once on an already-settled direct entry and ignores a different hash', () => {
    window.history.replaceState(
      null,
      '',
      '/app/profile?profile=personal#brand-colour'
    );
    const field = renderField();
    flushFrame();
    expect(scroll).toHaveBeenCalledTimes(1);
    field.unmount();
    window.history.replaceState(null, '', '/app/profile#other');
    renderField();
    flushFrame();
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('does not take over scrolling or focus after the user interacts before navigation settles', () => {
    window.history.replaceState(null, '', '/app/profile#brand-colour');
    useNavigationStore.setState({ phase: 'entering', transitionId: 12 });
    renderField();
    act(() => {
      window.dispatchEvent(new Event('wheel'));
    });
    act(() => useNavigationStore.setState({ phase: 'idle' }));
    flushFrame();
    expect(scroll).not.toHaveBeenCalled();
    expect(document.activeElement?.id).not.toBe('brand-colour');
  });

  it('cancels a scheduled anchor when the user interacts or the hash changes before the frame', () => {
    window.history.replaceState(null, '', '/app/profile#brand-colour');
    const field = renderField();
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    flushFrame();
    expect(scroll).not.toHaveBeenCalled();
    field.unmount();
    renderField();
    window.history.replaceState(null, '', '/app/profile#other');
    flushFrame();
    expect(scroll).not.toHaveBeenCalled();
  });
});
