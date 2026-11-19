import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
const crop = vi.hoisted(() => vi.fn());
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/image', () => ({
  default: ({
    onLoad,
    src,
    alt,
  }: {
    onLoad: () => void;
    src: string;
    alt: string;
  }) => createElement('img', { src, alt, onLoad }),
}));
vi.mock('react-image-crop', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
  convertToPixelCrop: () => ({ x: 0, y: 0, width: 20, height: 20 }),
}));
vi.mock('../../../../shared/image/imageCrop.utils', () => ({
  centeredAspectCrop: () => ({
    unit: '%',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  }),
  cropToFile: crop,
}));
vi.mock('../../../../primitives/AppDialog.atom', () => {
  const Dialog = ({
    children,
    open,
  }: {
    children: ReactNode;
    open: boolean;
  }) => (open ? <div>{children}</div> : null);
  Dialog.Content = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  Dialog.Actions = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return { AppDialogAtom: Dialog };
});
vi.mock(
  '../../../../../application/app-snackbar/appSnackbar.possibilities.api',
  () => ({ pushNewSnackbar: vi.fn() })
);
import { AvatarCropDialogOrganism } from './AvatarCropDialog.organism';

function deferred() {
  let resolve!: (file: File) => void;
  const promise = new Promise<File>(r => {
    resolve = r;
  });
  return { promise, resolve };
}
const file = new File(['x'], 'first.jpg', { type: 'image/jpeg' });
const nextFile = new File(['y'], 'second.jpg', { type: 'image/jpeg' });
const ready = () => fireEvent.load(screen.getByAltText('cropPreviewAlt'));

describe('crop cancellation', () => {
  it('does not confirm a crop after the cancel button is pressed', async () => {
    const job = deferred();
    const confirm = vi.fn();
    const cancel = vi.fn();
    crop.mockReset().mockReturnValueOnce(job.promise);
    render(
      <AvatarCropDialogOrganism
        open
        previewUrl='one'
        originalFile={file}
        onCancel={cancel}
        onConfirm={confirm}
      />
    );
    ready();
    fireEvent.click(screen.getByText('cropConfirm'));
    fireEvent.click(screen.getByText('cropCancel'));
    await act(async () => {
      job.resolve(file);
      await job.promise;
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });
  it('ignores cancelled work and does not clear the next crop loading state', async () => {
    const first = deferred(),
      second = deferred(),
      confirm = vi.fn(),
      cancel = vi.fn();
    crop
      .mockReset()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const view = render(
      <AvatarCropDialogOrganism
        open
        previewUrl='one'
        originalFile={file}
        onCancel={cancel}
        onConfirm={confirm}
      />
    );
    ready();
    fireEvent.click(screen.getByText('cropConfirm'));
    fireEvent.click(screen.getByText('cropCancel'));
    view.rerender(
      <AvatarCropDialogOrganism
        open={false}
        previewUrl='one'
        originalFile={file}
        onCancel={cancel}
        onConfirm={confirm}
      />
    );
    view.rerender(
      <AvatarCropDialogOrganism
        open
        previewUrl='two'
        originalFile={nextFile}
        onCancel={cancel}
        onConfirm={confirm}
      />
    );
    ready();
    fireEvent.click(screen.getByText('cropConfirm'));
    await act(async () => {
      first.resolve(file);
      await first.promise;
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'cropProcessing' })
    ).toBeDisabled();
    await act(async () => {
      second.resolve(nextFile);
      await second.promise;
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(nextFile);
  });
  it.each(['close', 'source', 'unmount'])(
    'ignores completion after %s',
    async action => {
      const job = deferred(),
        confirm = vi.fn(),
        cancel = vi.fn();
      crop.mockReset().mockReturnValueOnce(job.promise);
      const view = render(
        <AvatarCropDialogOrganism
          open
          previewUrl='one'
          originalFile={file}
          onCancel={cancel}
          onConfirm={confirm}
        />
      );
      ready();
      fireEvent.click(screen.getByText('cropConfirm'));
      if (action === 'unmount') {
        view.unmount();
      } else {
        view.rerender(
          <AvatarCropDialogOrganism
            open={action !== 'close'}
            previewUrl={action === 'source' ? 'two' : 'one'}
            originalFile={action === 'source' ? nextFile : file}
            onCancel={cancel}
            onConfirm={confirm}
          />
        );
      }
      await act(async () => {
        job.resolve(file);
        await job.promise;
      });
      expect(confirm).not.toHaveBeenCalled();
    }
  );
});
