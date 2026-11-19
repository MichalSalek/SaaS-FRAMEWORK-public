import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StylistAvatarFieldOrganism } from './StylistAvatarField.organism';

const state = vi.hoisted(() => ({
  user: {
    name: 'Anna Nowak',
    image: '/oauth.jpg',
    avatar_url: null as string | null,
  },
  upload: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/image', () => ({
  default: ({
    src,
    alt,
    onError,
  }: {
    src: string;
    alt: string;
    onError?: () => void;
  }) => createElement('img', { src, alt, onError }),
}));
vi.mock('../../../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({ data: state.user }),
}));
vi.mock('./useUploadAvatar', () => ({
  useUploadAvatar: () => ({
    upload: { mutateAsync: state.upload, reset: vi.fn(), isPending: false },
    remove: { mutate: state.remove, isPending: false },
  }),
}));
vi.mock('./AvatarCropDialog.organism', () => ({
  AvatarCropDialogOrganism: ({
    open,
    onCancel,
    onConfirm,
  }: {
    open: boolean;
    onCancel: () => void;
    onConfirm: (file: File) => void;
  }) =>
    open ? (
      <div>
        <button onClick={onCancel}>cancel crop</button>
        <button
          onClick={() =>
            onConfirm(new File(['x'], 'cropped.jpg', { type: 'image/jpeg' }))
          }>
          confirm crop
        </button>
      </div>
    ) : null,
}));
vi.mock('../../../../components/Button/Button.atom', () => ({
  ButtonAtom: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock('../../../../components/OutcomeFeedback/OutcomeState.molecule', () => ({
  OutcomeStateMolecule: () => null,
}));
vi.mock(
  '../../../../../application/app-snackbar/appSnackbar.possibilities.api',
  () => ({ pushNewSnackbar: vi.fn() })
);

beforeEach(() => {
  state.user = { name: 'Anna Nowak', image: '/oauth.jpg', avatar_url: null };
  state.upload.mockReset();
  state.upload.mockResolvedValue(undefined);
  state.remove.mockReset();
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  });
});
describe('photo editor', () => {
  it('opens the same crop flow from the accessible account avatar and permits reselecting after cancel', async () => {
    const { container } = render(<StylistAvatarFieldOrganism compact />);
    const input = container.querySelector(
      'input[type=file]'
    ) as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    const avatarButton = screen.getAllByRole('button', {
      name: 'uploadCta',
    })[0];
    expect(avatarButton).toBeDefined();
    fireEvent.click(avatarButton);
    expect(click).toHaveBeenCalledOnce();
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByText('cancel crop'));
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByText('confirm crop'));
    expect(state.upload).toHaveBeenCalledOnce();
  });
  it('lets a user remove only a custom photo', () => {
    const view = render(<StylistAvatarFieldOrganism />);
    expect(screen.queryByText('removeCta')).toBeNull();
    state.user.avatar_url = '/custom.jpg';
    view.rerender(<StylistAvatarFieldOrganism />);
    fireEvent.click(screen.getByText('removeCta'));
    expect(state.remove).toHaveBeenCalledOnce();
  });
});
