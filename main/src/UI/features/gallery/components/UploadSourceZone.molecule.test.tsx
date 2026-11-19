import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UploadSourceZoneMolecule } from './UploadSourceZone.molecule';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('../../../../application/analytics/flow-events', () => ({
  trackFlowStep: vi.fn(),
}));

describe('upload camera chooser interoperability', () => {
  it('requests the wildcard image capture mode required by Capacitor, separately from the library', () => {
    const onBeforePick = vi.fn();
    const onPickFromPhone = vi.fn();
    const { container } = render(
      <UploadSourceZoneMolecule
        dragActive={false}
        onBeforePick={onBeforePick}
        onPickFromPhone={onPickFromPhone}
        onFileSelect={vi.fn()}
        onDragEnter={vi.fn()}
        onDragOver={vi.fn()}
        onDragLeave={vi.fn()}
        onDrop={vi.fn()}
      />
    );
    const camera = container.querySelector<HTMLInputElement>('input[capture]');
    if (!camera) {
      throw new Error('Camera capture input is missing');
    }
    expect(camera.accept).toBe('image/*');
    expect(camera.getAttribute('capture')).toBe('environment');
    const openCamera = vi.spyOn(camera, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'uploadTakePhoto' }));
    expect(openCamera).toHaveBeenCalledOnce();
    expect(onBeforePick).toHaveBeenCalledOnce();
    expect(onPickFromPhone).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'uploadPickFromPhone' })
    );
    expect(onPickFromPhone).toHaveBeenCalledOnce();
    expect(openCamera).toHaveBeenCalledOnce();
  });
});
