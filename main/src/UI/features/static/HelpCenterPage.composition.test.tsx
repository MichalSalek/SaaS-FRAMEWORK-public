import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HelpCenterPageComposition } from './HelpCenterPage.composition';

const route = vi.hoisted(() => ({
  isReady: true,
  query: {} as { tab?: string },
  push: vi.fn(),
}));
vi.mock('next/router', () => ({ useRouter: () => route }));
vi.mock('next-intl', () => ({
  useLocale: () => 'pl',
  useTranslations: () => (key: string) =>
    key.startsWith('faq.') ? `${key} session` : key,
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('../../layouts/PublicLayout.composition', () => ({
  PublicLayoutComposition: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../../components/StickyCtaBar/StickyCtaBar.molecule', () => ({
  StickyCtaBarMolecule: () => null,
}));
vi.mock('../../hooks/useShowOnScroll', () => ({
  useShowOnScroll: () => false,
}));
vi.mock('../../../application/analytics/cta-events', () => ({
  trackCtaClick: vi.fn(),
  withCtaTracking: vi.fn(),
}));
vi.mock('./HelpCenterPage.blocks.organism', () => ({
  CategoriesGridOrganism: () => null,
  PopularArticlesOrganism: () => null,
}));
vi.mock('./HelpCenterPage.cta.organism', () => ({
  PopularTagsOrganism: ({
    onTagClick,
  }: {
    onTagClick: (query: string) => void;
  }) => (
    <>
      <button onClick={() => onTagClick('session')}>popular session</button>
      <button onClick={() => onTagClick('technical')}>popular technical</button>
    </>
  ),
  BottomCtaOrganism: () => null,
  ContactFooterOrganism: () => null,
}));

beforeEach(() => {
  route.query = {};
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('Help Center search mode', () => {
  it('hides category tabs and removes tabpanel semantics for popular results, then resets focus and expansion', () => {
    route.query = { tab: 'clients' };
    render(<HelpCenterPageComposition />);
    fireEvent.click(
      screen.getByRole('button', { name: 'faq.clients.q1 session' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'popular session' }));
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole('region', { name: 'tabs.sectionHeadline' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'search.allQuestions' })
    );
    expect(screen.getByRole('searchbox')).toHaveValue('');
    const selectedTab = screen.getByRole('tab', { name: 'tabs.clients' });
    expect(selectedTab).toHaveAttribute('aria-selected', 'true');
    expect(selectedTab).toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'faq.clients.q1 session' })
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps typed focus, handles empty results, switches popular searches and resets repeatedly', () => {
    render(<HelpCenterPageComposition />);
    const input = screen.getByRole('searchbox');
    input.focus();
    fireEvent.change(input, { target: { value: 'unknown' } });
    expect(input).toHaveFocus();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    // Every original question remains mounted, including nonmatching results.
    expect(
      screen.getAllByRole('button', { name: /^faq\./, hidden: true })
    ).toHaveLength(43);
    fireEvent.click(screen.getByRole('button', { name: 'popular session' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^faq\./ })).toHaveLength(43);
    fireEvent.click(screen.getByRole('button', { name: 'popular technical' }));
    expect(input).toHaveValue('technical');
    expect(screen.getAllByRole('button', { name: /^faq\./ })).toHaveLength(7);
    fireEvent.click(
      screen.getByRole('button', { name: 'search.allQuestions' })
    );
    const general = screen.getByRole('tab', { name: 'tabs.general' });
    expect(general).toHaveFocus();
    fireEvent.keyDown(general, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'tabs.stylists' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'popular session' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'search.allQuestions' })
    );
    expect(screen.getByRole('tab', { name: 'tabs.general' })).toHaveFocus();
    fireEvent.change(input, { target: { value: ' ?! ' } });
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('clears stale search on route changes and resolves absent or invalid categories to general', () => {
    const { rerender } = render(<HelpCenterPageComposition />);
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'unknown' },
    });
    route.query = { tab: 'technical' };
    rerender(<HelpCenterPageComposition />);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('tab', { name: 'tabs.technical' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    route.query = { tab: 'invalid' };
    rerender(<HelpCenterPageComposition />);
    expect(screen.getByRole('tab', { name: 'tabs.general' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    fireEvent.click(screen.getByRole('tab', { name: 'tabs.clients' }));
    route.query = {};
    rerender(<HelpCenterPageComposition />);
    expect(screen.getByRole('tab', { name: 'tabs.general' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(route.push).not.toHaveBeenCalled();
  });
});
