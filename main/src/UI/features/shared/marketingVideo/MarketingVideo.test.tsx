import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketingVideoOrganism } from './MarketingVideo.organism';
import { trackMarketingVideo } from './marketingVideo.analytics';
import type * as VideoAnalytics from './marketingVideo.analytics';
import type { ResolvedMarketingVideo } from './marketingVideo.config';

vi.mock('next-intl', () => ({
  useTranslations:
    () => (key: string, values?: Record<string, string | number>) =>
      key === 'progressValue'
        ? `${values?.elapsed} of ${values?.total}`
        : values
          ? `${values.seconds} s`
          : key,
}));
vi.mock('./marketingVideo.analytics', async importOriginal => ({
  ...(await importOriginal<typeof VideoAnalytics>()),
  trackMarketingVideo: vi.fn(),
}));

const media: ResolvedMarketingVideo = {
  videoLanguage: 'en',
  captionLanguage: 'de',
  uiLanguage: 'de',
  asset: {
    id: 'kod-na-blacie',
    version: 'v1',
    approved: true,
    captionsBurnedIn: false,
    durationSeconds: 58,
    src: '/media/kod-na-blacie/approved-en.mp4',
    captions: {
      en: '/media/kod-na-blacie/en.vtt',
      de: '/media/kod-na-blacie/de.vtt',
    },
  },
};
let intersection: IntersectionObserverCallback;
const disconnect = vi.fn();

class Observer {
  constructor(callback: IntersectionObserverCallback) {
    intersection = callback;
  }
  observe = vi.fn();
  disconnect = disconnect;
}

function videoElement() {
  return screen.getByLabelText<HTMLVideoElement>('label', {
    selector: 'video',
  });
}
function changedIntersection(isIntersecting: boolean) {
  act(() =>
    intersection(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  );
}
function played(video: HTMLVideoElement, ranges: [number, number][]) {
  Object.defineProperty(video, 'duration', { configurable: true, value: 58 });
  Object.defineProperty(video, 'played', {
    configurable: true,
    value: {
      length: ranges.length,
      start: (index: number) => ranges[index]?.[0] ?? 0,
      end: (index: number) => ranges[index]?.[1] ?? 0,
    },
  });
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Observer);
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => null,
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  Reflect.deleteProperty(document, 'fullscreenElement');
});

describe('on-demand marketing video', () => {
  it('has no source, track request or native autoplay before the visitor clicks', () => {
    render(<MarketingVideoOrganism media={media} />);
    const video = videoElement();
    expect(video.getAttribute('src')).toBeNull();
    expect(video.querySelector('track[src]')).toBeNull();
    expect(video.preload).toBe('none');
    expect(video.autoplay).toBe(false);
    expect(video.controls).toBe(false);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it('shows actual media time, supports seeking while paused and tracks the end', () => {
    render(<MarketingVideoOrganism media={media} />);
    fireEvent.click(screen.getByRole('button', { name: 'playLabel' }));
    const video = videoElement();
    const slider = screen.getByRole<HTMLInputElement>('slider', {
      name: 'progress',
    });
    expect(slider.disabled).toBe(true);
    expect(slider.getAttribute('aria-valuetext')).toBe('0:00 of --:--');

    Object.defineProperty(video, 'duration', { configurable: true, value: 30 });
    fireEvent.loadedMetadata(video);
    expect(slider.disabled).toBe(false);
    expect(slider.getAttribute('aria-valuetext')).toBe('0:00 of 0:30');
    video.currentTime = 7;
    fireEvent.timeUpdate(video);
    fireEvent.pause(video);
    expect(slider.valueAsNumber).toBe(7);
    expect(slider.getAttribute('aria-valuetext')).toBe('0:07 of 0:30');

    fireEvent.change(slider, { target: { value: '19' } });
    expect(video.currentTime).toBe(19);
    expect(slider.getAttribute('aria-valuetext')).toBe('0:19 of 0:30');
    Object.defineProperty(video, 'seeking', {
      configurable: true,
      value: true,
    });
    video.currentTime = 24;
    fireEvent.seeking(video);
    fireEvent.timeUpdate(video);
    expect(slider.getAttribute('aria-valuetext')).toBe('0:24 of 0:30');
    expect(trackMarketingVideo).not.toHaveBeenCalledWith(
      'marketing_video_progress',
      expect.anything(),
      expect.anything()
    );
    Object.defineProperty(video, 'seeking', {
      configurable: true,
      value: false,
    });
    fireEvent.seeked(video);
    video.currentTime = 30;
    fireEvent.ended(video);
    expect(slider.getAttribute('aria-valuetext')).toBe('0:30 of 0:30');
  });
  it('does not invent duration and hides progress on a playback error', () => {
    render(<MarketingVideoOrganism media={media} />);
    fireEvent.click(screen.getByRole('button', { name: 'playLabel' }));
    const video = videoElement();
    Object.defineProperty(video, 'duration', {
      configurable: true,
      value: Infinity,
    });
    fireEvent.durationChange(video);
    expect(screen.getByRole<HTMLInputElement>('slider').disabled).toBe(true);
    fireEvent.error(video);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
  it('starts the same element from the click and selects DE captions over EN audio', () => {
    render(<MarketingVideoOrganism media={media} />);
    const video = videoElement();
    fireEvent.click(screen.getByRole('button', { name: 'playLabel' }));
    expect(videoElement()).toBe(video);
    expect(video.getAttribute('src')).toBe(media.asset.src);
    expect(video.controls).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    const defaultTrack = video.querySelector('track[default]');
    expect(defaultTrack?.getAttribute('srclang')).toBe('de');
    expect(defaultTrack?.getAttribute('src')).toBe(
      '/media/kod-na-blacie/de.vtt'
    );
  });
  it('exposes visibility only for the activated frame and clears the marker on unmount', () => {
    const view = render(<MarketingVideoOrganism media={media} />);
    const frame = screen.getByRole('group', { name: 'label' });
    expect(frame.hasAttribute('data-marketing-video')).toBe(true);
    expect(frame.getAttribute('data-in-view')).toBe('false');
    changedIntersection(true);
    expect(frame.getAttribute('data-in-view')).toBe('true');
    expect(
      document.querySelector(
        '[data-marketing-video][data-active][data-in-view="true"]'
      )
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'playLabel' }));
    expect(
      document.querySelector(
        '[data-marketing-video][data-active][data-in-view="true"]'
      )
    ).toBe(frame);
    changedIntersection(false);
    expect(frame.getAttribute('data-in-view')).toBe('false');
    view.unmount();
    expect(document.querySelector('[data-marketing-video]')).toBeNull();
  });
  it('pauses only when wholly offscreen and never automatically resumes', () => {
    render(<MarketingVideoOrganism media={media} />);
    fireEvent.click(screen.getByRole('button', { name: 'playLabel' }));
    changedIntersection(true);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    changedIntersection(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce();
    changedIntersection(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  });
  it('keeps user-initiated fullscreen playing when the inline frame is offscreen', () => {
    render(<MarketingVideoOrganism media={media} />);
    vi.spyOn(document, 'fullscreenElement', 'get').mockReturnValue(
      videoElement()
    );
    changedIntersection(false);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });
  it('pauses in a hidden tab and releases observers/playback on unmount', () => {
    const view = render(<MarketingVideoOrganism media={media} />);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce();
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(2);
  });
  it('does not turn an intentionally cancelled pending play into an error', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      new DOMException('Playback interrupted by a pause', 'AbortError')
    );
    render(<MarketingVideoOrganism media={media} />);
    fireEvent.click(screen.getByRole('button', { name: 'playLabel' }));
    await act(async () => {});
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      vi
        .mocked(trackMarketingVideo)
        .mock.calls.filter(c => c[0] === 'marketing_video_error')
    ).toHaveLength(0);
  });
  it('allows a rejected play attempt to be retried', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      new Error('blocked')
    );
    render(<MarketingVideoOrganism media={media} />);
    fireEvent.click(screen.getByRole('button', { name: 'playLabel' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });
  it('measures played ranges once per threshold rather than crediting seeks', () => {
    render(<MarketingVideoOrganism media={media} />);
    fireEvent.click(screen.getByRole('button', { name: 'playLabel' }));
    const video = videoElement();
    fireEvent.play(video);
    fireEvent.play(video);
    expect(
      vi
        .mocked(trackMarketingVideo)
        .mock.calls.filter(c => c[0] === 'marketing_video_started')
    ).toHaveLength(1);
    played(video, [
      [0, 3],
      [50, 51],
    ]);
    fireEvent.timeUpdate(video);
    expect(
      vi
        .mocked(trackMarketingVideo)
        .mock.calls.filter(c => c[0] === 'marketing_video_progress')
    ).toHaveLength(0);
    played(video, [[0, 29]]);
    fireEvent.timeUpdate(video);
    fireEvent.timeUpdate(video);
    expect(
      vi
        .mocked(trackMarketingVideo)
        .mock.calls.filter(c => c[0] === 'marketing_video_progress')
        .map(c => c[2]?.percent)
    ).toEqual([25, 50]);
    fireEvent.ended(video);
    expect(trackMarketingVideo).toHaveBeenCalledWith(
      'marketing_video_ended',
      media,
      { watched_percent: 50 }
    );
  });
});
