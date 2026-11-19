import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProfileSaveLineMolecule } from './ProfileSaveLine.molecule';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

describe('profile durable save feedback', () => {
  it('does not keep a saved check for a newer unsaved draft', () => {
    const props = {
      isSaving: true,
      isDirty: true,
      hasFailure: false,
      onRetry: vi.fn(),
    };
    const view = render(<ProfileSaveLineMolecule {...props} />);
    expect(screen.getByText('savePending')).toBeTruthy();
    view.rerender(
      <ProfileSaveLineMolecule {...props} isSaving={false} isDirty={false} />
    );
    expect(screen.getByText('saveDone')).toBeTruthy();
    view.rerender(
      <ProfileSaveLineMolecule {...props} isSaving={false} isDirty />
    );
    expect(screen.getByText('saveDirty')).toBeTruthy();
    expect(screen.queryByText('saveDone')).toBeNull();
  });
  it('does not show completion when the queue ended in failure', () => {
    const props = {
      isSaving: true,
      isDirty: true,
      hasFailure: false,
      onRetry: vi.fn(),
    };
    const view = render(<ProfileSaveLineMolecule {...props} />);
    view.rerender(
      <ProfileSaveLineMolecule {...props} isSaving={false} hasFailure />
    );
    expect(screen.getByRole('alert').textContent).toBe('saveFailed');
    expect(screen.queryByText('saveDone')).toBeNull();
    expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy();
  });
});
