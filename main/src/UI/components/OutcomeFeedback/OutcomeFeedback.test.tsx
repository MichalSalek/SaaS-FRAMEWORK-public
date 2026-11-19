import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompletionLineMolecule } from './CompletionLine.molecule';
import { OutcomeStateMolecule } from './OutcomeState.molecule';
import { SuccessSceneOrganism } from './SuccessScene.organism';
import { AppHeroVisibilityContext } from '../AppHero/appHeroVisibility';
import { AppBarTitleMolecule } from '../../layouts/AppLayout.appBarTitle.molecule';

afterEach(() => vi.restoreAllMocks());

describe('outcome primitives', () => {
  it('keeps an empty live region without reserving invisible copy or retry space at rest', () => {
    const view = render(
      <CompletionLineMolecule
        state='idle'
        message=''
        reserveMessage='A long save error'
        reserveAction={<button>Retry sizing copy</button>}>
        {false}
      </CompletionLineMolecule>
    );
    const live = screen.getByRole('status');
    expect(live.textContent).toBe('');
    expect(screen.queryByText('A long save error')).toBeNull();
    expect(screen.queryByText('Retry sizing copy')).toBeNull();
    view.rerender(
      <CompletionLineMolecule
        state='pending'
        message='Saving'
        reserveMessage='A long save error'
      />
    );
    expect(screen.getByRole('status')).toBe(live);
    expect(live).toHaveTextContent('Saving');
    expect(screen.getByText('A long save error')).toBeInTheDocument();
  });
  it('updates one persistent live region without exposing the sizing copy', () => {
    const view = render(
      <CompletionLineMolecule
        state='blocked'
        message='Missing'
        reserveMessage='Longest message'
      />
    );
    const line = screen.getByRole('status');
    expect(line).toHaveTextContent('Missing');
    expect(line).not.toHaveTextContent('Longest message');
    view.rerender(
      <CompletionLineMolecule
        state='complete'
        message='Ready'
        reserveMessage='Longest message'
      />
    );
    expect(screen.getByRole('status')).toBe(line);
    expect(line).toHaveTextContent('Ready');
    view.rerender(<CompletionLineMolecule state='dirty' message='Unsaved' />);
    expect(screen.getByRole('status')).toBe(line);
    expect(line).toHaveTextContent('Unsaved');
    expect(line).not.toHaveTextContent('Ready');
  });
  it('animates a new confirmation once and keeps the existing live node', () => {
    const style = document.createElement('span').style;
    style.setProperty('--outcome-change-duration', '200ms');
    vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue(style);
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'animate'
    );
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    });
    try {
      const view = render(
        <OutcomeStateMolecule confirmed completionKey='one' message='Saved' />
      );
      const line = screen.getByRole('status');
      expect(animate).not.toHaveBeenCalled();
      view.rerender(
        <OutcomeStateMolecule
          confirmed
          completionKey='two'
          message='Saved again'
        />
      );
      expect(animate).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status')).toBe(line);
      view.rerender(
        <OutcomeStateMolecule
          confirmed
          completionKey='two'
          message='Saved again'
        />
      );
      expect(animate).toHaveBeenCalledTimes(1);
      view.rerender(<OutcomeStateMolecule confirmed={false} message='Saved' />);
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, 'animate', descriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'animate');
      }
    }
  });
  it('renders no empty box before a result, so it never adds a layout gap', () => {
    const view = render(
      <OutcomeStateMolecule confirmed={false} message='Saved' />
    );
    expect(view.container.firstChild).toBeNull();
    view.rerender(
      <OutcomeStateMolecule confirmed marked={false} message={undefined} />
    );
    expect(view.container.firstChild).toBeNull();
    view.rerender(
      <OutcomeStateMolecule confirmed={false}>
        <span>Child</span>
      </OutcomeStateMolecule>
    );
    expect(screen.getByText('Child')).toBeTruthy();
    view.rerender(<OutcomeStateMolecule confirmed message='Saved' />);
    expect(screen.getByRole('status').textContent).toBe('Saved');
  });
  it('offers immediate actions without an extra dialog or mandatory dismissal', () => {
    render(
      <SuccessSceneOrganism
        title='Ready'
        firstTime
        actions={<button>Continue</button>}
      />
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('region', { name: 'Ready' })).toBeInTheDocument();
  });
  it('keeps the app bar as the only h1 and focuses the success heading', () => {
    render(
      <AppHeroVisibilityContext.Provider
        value={{ reportVisible: vi.fn(), reportPresent: vi.fn() }}>
        <AppBarTitleMolecule avatar={null} title='Done' asHeading />
        <SuccessSceneOrganism
          title='Account ready'
          actions={<button>Continue</button>}
        />
      </AppHeroVisibilityContext.Provider>
    );

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Done' })
    ).toBeVisible();
    const heading = screen.getByRole('heading', {
      level: 2,
      name: 'Account ready',
    });
    expect(heading).toHaveFocus();
    expect(
      screen.getByRole('region', { name: 'Account ready' })
    ).toContainElement(heading);
  });
  it('uses an h1 without an app bar, including the null desktop context', () => {
    render(
      <AppHeroVisibilityContext.Provider value={null}>
        <SuccessSceneOrganism
          title='Ready'
          actions={<button>Continue</button>}
        />
      </AppHeroVisibilityContext.Provider>
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Ready' })
    ).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Ready' })).toBeInTheDocument();
  });
  it('honors an explicit title level and id under the app bar', () => {
    render(
      <AppHeroVisibilityContext.Provider
        value={{ reportVisible: vi.fn(), reportPresent: vi.fn() }}>
        <SuccessSceneOrganism
          title='Explicit title'
          titleAs='h1'
          titleId='explicit-success-title'
          actions={<button>Continue</button>}
        />
      </AppHeroVisibilityContext.Provider>
    );
    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'Explicit title',
    });
    expect(heading).toHaveFocus();
    expect(
      screen.getByRole('region', { name: 'Explicit title' })
    ).toHaveAttribute('aria-labelledby', 'explicit-success-title');
  });
});
