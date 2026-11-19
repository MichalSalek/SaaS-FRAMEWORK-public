import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { SessionNextStepsMolecule } from './SessionNextSteps.molecule';
import {
  readComposerDraft,
  writeComposerDraft,
} from '../../shared/messaging/hooks/useComposerDraft';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../../../components/Button/LinkButton.atom', () => ({
  LinkButtonAtom: ({
    href,
    onClick,
    children,
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      onClick={event => {
        event.preventDefault();
        onClick?.(event);
      }}>
      {children}
    </a>
  ),
}));

const pair = 'next-steps-draft-regression';
const key = `messaging:${pair}`;
afterEach(() => writeComposerDraft(key, ''));

describe('suggested appointment message', () => {
  it.each(['Mogę w czwartek po 16. Zależy mi na krótkich paznokciach.', '   '])(
    'preserves an existing unsent draft: %s',
    draft => {
      writeComposerDraft(key, draft);
      render(<SessionNextStepsMolecule pairId={pair} phone={null} />);
      const link = screen.getByRole('link', { name: 'afterShareMessage' });
      expect(link).toHaveAttribute('href', `/app/messages/${pair}`);
      fireEvent.click(link);
      expect(readComposerDraft(key)).toBe(draft);
    }
  );

  it('offers the template when empty and preserves a later edit on another click', () => {
    render(<SessionNextStepsMolecule pairId={pair} phone={null} />);
    const link = screen.getByRole('link', { name: 'afterShareMessage' });
    fireEvent.click(link);
    expect(readComposerDraft(key)).toBe('afterShareDraft');
    writeComposerDraft(key, 'A jednak poproszę o piątek.');
    fireEvent.click(link);
    expect(readComposerDraft(key)).toBe('A jednak poproszę o piątek.');
  });
});
