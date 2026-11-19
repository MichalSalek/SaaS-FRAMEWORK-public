import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeHeroOrganism } from './HomeHero.organism';
import type { MarketingVideoRegistry } from '../shared/marketingVideo/marketingVideo.config';

vi.mock('next-intl', () => ({
  useLocale: () => 'pl',
  useTranslations: () => (key: string) => key,
}));
vi.mock('../shared/lpScenes/HeroAppScenes.molecule', () => ({
  HeroPhoneStageMolecule: () => <div role='img' aria-label='existing phone' />,
}));
vi.mock('../../components/AppParagraphLink/AppParagraphLink.atom', () => ({
  AppParagraphLinkAtom: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
vi.mock('../shared/marketingVideo/MarketingVideo.organism', () => ({
  MarketingVideoOrganism: () => <button>play video</button>,
}));
const registry: MarketingVideoRegistry = {
  pl: {
    id: 'kod-na-blacie',
    version: 'v1',
    src: '/media/kod-na-blacie/pl.mp4',
    durationSeconds: 58,
    approved: true,
    captionsBurnedIn: false,
    captions: { pl: '/media/kod-na-blacie/pl.vtt' },
  },
  en: null,
};
afterEach(cleanup);

describe('home explainer integration', () => {
  it('preserves the current illustration and signup when no approved film exists', () => {
    const signup = vi.fn();
    render(<HomeHeroOrganism onSignup={signup} />);
    expect(screen.getByRole('img', { name: 'existing phone' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'play video' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'hero.ctaPrimary' }));
    expect(signup).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
  it('replaces only the illustration, leaving the original actions ahead of playback', () => {
    const signup = vi.fn();
    render(<HomeHeroOrganism onSignup={signup} videoRegistry={registry} />);
    expect(screen.queryByRole('img', { name: 'existing phone' })).toBeNull();
    const primary = screen.getByRole('button', { name: 'hero.ctaPrimary' });
    const client = screen.getByRole('link', { name: 'hero.ctaForClients' });
    const play = screen.getByRole('button', { name: 'play video' });
    expect(
      client.compareDocumentPosition(play) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByText('hero.proof1')).toBeTruthy();
    fireEvent.click(primary);
    expect(signup).toHaveBeenCalledOnce();
  });
});
