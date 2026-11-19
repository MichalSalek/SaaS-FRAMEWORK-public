import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readBottomSurfaceHex,
  readTopSurfaceHex,
  statusBarStyleForHex,
  systemBarIconStyleForHex,
} from './status-bar.surface';

type Pixel = readonly [number, number, number, number];

const pixels = new Map<string, Pixel>([
  ['#010203', [1, 2, 3, 255]],
  ['rgba(0, 0, 0, 0)', [0, 0, 0, 0]],
  ['rgba(255, 255, 255, 0.7)', [255, 255, 255, 179]],
  ['#161616', [22, 22, 22, 255]],
  ['#f8f8f8', [248, 248, 248, 255]],
  ['oklch(0.9 0.02 80)', [238, 220, 200, 255]],
]);

let backgrounds: WeakMap<Element, string>;
let topElement: Element | null;
let bottomElement: Element | null;
let bgToken = '';
let originalElementFromPoint: Document['elementFromPoint'] | undefined;

function fakeCanvas(): HTMLCanvasElement {
  let fillStyle = '#010203';
  let pixel: Pixel = [0, 0, 0, 0];
  const context = {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string) {
      if (pixels.has(value)) {
        fillStyle = value;
      }
    },
    clearRect() {
      pixel = [0, 0, 0, 0];
    },
    fillRect() {
      pixel = pixels.get(fillStyle) ?? [0, 0, 0, 0];
    },
    getImageData() {
      return { data: Uint8ClampedArray.from(pixel) };
    },
  };
  return {
    width: 1,
    height: 1,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
}

function setBackground(element: Element, value: string) {
  backgrounds.set(element, value);
}

function preparePage(): {
  leaf: HTMLElement;
  header: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
} {
  document.body.replaceChildren();
  const header = document.createElement('header');
  const leaf = document.createElement('span');
  const footer = document.createElement('footer');
  document.body.append(header, footer);
  header.appendChild(leaf);
  setBackground(document.documentElement, 'rgba(0, 0, 0, 0)');
  setBackground(document.body, 'rgba(0, 0, 0, 0)');
  setBackground(header, 'rgba(0, 0, 0, 0)');
  setBackground(leaf, 'rgba(0, 0, 0, 0)');
  setBackground(footer, 'rgba(0, 0, 0, 0)');
  topElement = leaf;
  bottomElement = footer;
  return { leaf, header, body: document.body, footer };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalElementFromPoint == null) {
    delete (
      document as unknown as {
        elementFromPoint?: Document['elementFromPoint'];
      }
    ).elementFromPoint;
  } else {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: originalElementFromPoint,
    });
  }
});

describe('native status-bar surface sampling', () => {
  it('uses the nearest opaque surface at the top point even when html has a different theme token', () => {
    const { header, body } = preparePage();
    setBackground(header, 'rgba(255, 255, 255, 0.7)');
    setBackground(body, '#161616');
    bgToken = '#f8f8f8';

    expect(readTopSurfaceHex()).toBe('#161616');
    expect(statusBarStyleForHex('#161616')).toBe('DARK');
  });

  it('uses a public header surface instead of the dark page behind it', () => {
    const { header, body } = preparePage();
    setBackground(header, '#f8f8f8');
    setBackground(body, '#161616');
    bgToken = '#161616';

    expect(readTopSurfaceHex()).toBe('#f8f8f8');
    expect(statusBarStyleForHex('#f8f8f8')).toBe('LIGHT');
  });

  it('samples a lower-page surface independently from the top header', () => {
    const { header, body, footer } = preparePage();
    setBackground(header, '#161616');
    setBackground(body, '#161616');
    setBackground(footer, '#f8f8f8');
    bgToken = '#161616';

    expect(readTopSurfaceHex()).toBe('#161616');
    expect(readBottomSurfaceHex()).toBe('#f8f8f8');
    expect(systemBarIconStyleForHex('#f8f8f8')).toBe('dark');
  });

  it('keeps the page surface when a contrasting action crosses the bottom edge', () => {
    const { footer } = preparePage();
    const action = document.createElement('a');
    footer.appendChild(action);
    setBackground(footer, '#161616');
    setBackground(action, '#f8f8f8');
    bottomElement = action;

    expect(readBottomSurfaceHex()).toBe('#161616');
  });

  it('rasterizes CSS Color 4 tokens for the app-token fallback when no opaque surface is found', () => {
    preparePage();
    bgToken = 'oklch(0.9 0.02 80)';

    expect(readTopSurfaceHex()).toBe('#eedcc8');
    expect(readBottomSurfaceHex()).toBe('#eedcc8');
  });

  it('uses the contrast-winning icon polarity across light, dark and mid-tone surfaces', () => {
    expect(statusBarStyleForHex('#000000')).toBe('DARK');
    expect(statusBarStyleForHex('#ffffff')).toBe('LIGHT');
    expect(statusBarStyleForHex('#777777')).toBe('LIGHT');
    expect(systemBarIconStyleForHex('#000000')).toBe('light');
    expect(systemBarIconStyleForHex('#ffffff')).toBe('dark');
  });
});

beforeEach(() => {
  backgrounds = new WeakMap();
  topElement = null;
  bottomElement = null;
  bgToken = '';
  originalElementFromPoint = document.elementFromPoint;

  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName.toLowerCase() === 'canvas') {
      return fakeCanvas();
    }
    return document.createElementNS(
      'http://www.w3.org/1999/xhtml',
      tagName
    ) as HTMLElement;
  }) as typeof document.createElement);

  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn((_x: number, y: number) =>
      y > window.innerHeight / 2 ? bottomElement : topElement
    ),
  });

  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    ((element: Element) =>
      ({
        backgroundColor: backgrounds.get(element) ?? 'rgba(0, 0, 0, 0)',
        getPropertyValue: (name: string) =>
          element === document.documentElement && name === '--color-bg-main'
            ? bgToken
            : '',
      }) as CSSStyleDeclaration) as typeof window.getComputedStyle
  );
});
