import { act, cleanup, renderHook } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { useKeepFocusedFieldVisible } from './useKeepFocusedFieldVisible';

const rect = (top: number, bottom: number) =>
  ({ top, bottom, height: bottom - top }) as DOMRect;

let container: HTMLDivElement;
let field: HTMLTextAreaElement;
let fieldTop: number;
let fieldHeight: number;
let viewport: EventTarget & { offsetTop: number; height: number };
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let onObservedResize: ResizeObserverCallback;
let disconnect: ReturnType<typeof vi.fn>;
let scrollBy: Mock<(options?: ScrollToOptions | number, y?: number) => void>;

function flushFrame() {
  const queued = [...frames.values()];
  frames.clear();
  act(() => queued.forEach(callback => callback(0)));
}

function firstScrollOptions(): ScrollToOptions {
  const options = scrollBy.mock.calls[0]?.[0];
  if (typeof options !== 'object' || options === null) {
    throw new Error('Expected scrolling through the options overload');
  }
  return options;
}

beforeEach(() => {
  fieldTop = 437.18;
  fieldHeight = 121.52;
  container = document.createElement('div');
  field = document.createElement('textarea');
  container.append(field);
  document.body.append(container);
  Object.defineProperties(container, {
    clientHeight: { configurable: true, value: 533.33 },
    scrollHeight: { configurable: true, value: 1200 },
  });
  container.scrollTop = 100;
  container.style.overflowY = 'auto';
  container.style.scrollPaddingBottom = '76px';
  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() =>
    rect(0, 533.33)
  );
  vi.spyOn(field, 'getBoundingClientRect').mockImplementation(() =>
    rect(fieldTop, fieldTop + fieldHeight)
  );
  scrollBy = vi.fn((options?: ScrollToOptions | number, y?: number) => {
    const top = typeof options === 'number' ? (y ?? 0) : (options?.top ?? 0);
    fieldTop -= top;
    container.scrollTop += top;
  });
  container.scrollBy = scrollBy;
  viewport = Object.assign(new EventTarget(), { offsetTop: 0, height: 533.33 });
  vi.stubGlobal('visualViewport', viewport);
  frames = new Map();
  frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++frameId;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        onObservedResize = callback;
      }
      observe() {}
      disconnect = disconnect;
    }
  );
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useKeepFocusedFieldVisible', () => {
  it('scrolls the observed Android textarea above the nav and stays stable', () => {
    renderHook(() => useKeepFocusedFieldVisible(container));
    act(() => field.focus());
    expect(frames.size).toBe(1);
    flushFrame();
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(firstScrollOptions().behavior).toBe('instant');
    expect(firstScrollOptions().top).toBeCloseTo(101.37, 2);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    flushFrame();
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(field);
  });

  it('responds to visual, window, and observed container resize while coalescing frames', () => {
    viewport.height = 800;
    vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() =>
      rect(0, 800)
    );
    renderHook(() => useKeepFocusedFieldVisible(container));
    act(() => field.focus());
    flushFrame();
    expect(scrollBy).not.toHaveBeenCalled();
    viewport.height = 533.33;
    act(() => {
      viewport.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
      onObservedResize([], {} as ResizeObserver);
    });
    expect(frames.size).toBe(1);
    flushFrame();
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it('handles a contenteditable and leaves its content and focus intact', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    editable.tabIndex = 0;
    editable.textContent = 'draft';
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    vi.spyOn(editable, 'getBoundingClientRect').mockReturnValue(rect(450, 510));
    container.append(editable);
    renderHook(() => useKeepFocusedFieldVisible(container));
    act(() => editable.focus());
    flushFrame();
    expect(firstScrollOptions().top).toBeCloseTo(52.67, 2);
    expect(editable.textContent).toBe('draft');
    expect(document.activeElement).toBe(editable);
  });

  it('uses visual viewport offsets and top padding when a field is above view', () => {
    viewport.offsetTop = 40;
    container.style.scrollPaddingTop = '12px';
    fieldTop = 30;
    fieldHeight = 20;
    renderHook(() => useKeepFocusedFieldVisible(container));
    act(() => field.focus());
    flushFrame();
    expect(firstScrollOptions().top).toBe(-22);
  });

  it('uses the window viewport when visualViewport is unavailable', () => {
    vi.stubGlobal('visualViewport', undefined);
    vi.stubGlobal('innerHeight', 533.33);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect(0, 800));
    renderHook(() => useKeepFocusedFieldVisible(container));
    act(() => field.focus());
    flushFrame();
    expect(firstScrollOptions().top).toBeCloseTo(101.37, 2);
  });

  it('ignores external and nested-dialog focus, non-text controls and readonly fields', () => {
    const outside = document.createElement('input');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const dialogField = document.createElement('input');
    dialog.append(dialogField);
    container.append(checkbox, dialog);
    document.body.append(outside);
    renderHook(() => useKeepFocusedFieldVisible(container));
    for (const target of [outside, checkbox, dialogField]) {
      act(() => {
        target.focus();
        window.dispatchEvent(new Event('resize'));
      });
      flushFrame();
    }
    field.readOnly = true;
    act(() => field.focus());
    flushFrame();
    field.readOnly = false;
    field.disabled = true;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    flushFrame();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('ignores tall editors and containers that cannot scroll', () => {
    renderHook(() => useKeepFocusedFieldVisible(container));
    fieldHeight = 600;
    act(() => field.focus());
    flushFrame();
    fieldHeight = 121.52;
    container.style.overflowY = 'hidden';
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    flushFrame();
    container.style.overflowY = 'auto';
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      value: 533.33,
    });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    flushFrame();
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('cancels pending work and removes all resize listeners on unmount', () => {
    const { unmount } = renderHook(() => useKeepFocusedFieldVisible(container));
    act(() => field.focus());
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
    act(() => {
      window.dispatchEvent(new Event('resize'));
      viewport.dispatchEvent(new Event('resize'));
      onObservedResize([], {} as ResizeObserver);
    });
    expect(frames.size).toBe(0);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
