export type StatusBarStyle = 'DARK' | 'LIGHT' | 'DEFAULT';

type Rgba = { red: number; green: number; blue: number; alpha: number };

const BACKGROUND_TOKEN = '--color-bg-main';
const CANVAS_SENTINEL = '#010203';
const OPAQUE_ALPHA = 0.995;

function rasterizeCssColor(value: string): Rgba | null {
  if (typeof document === 'undefined' || value.trim() === '') {
    return null;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (context == null) {
      return null;
    }

    context.clearRect(0, 0, 1, 1);
    context.fillStyle = CANVAS_SENTINEL;
    context.fillStyle = value;
    if (context.fillStyle === CANVAS_SENTINEL && value !== CANVAS_SENTINEL) {
      return null;
    }

    context.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
    return { red, green, blue, alpha: alpha / 255 };
  } catch {
    return null;
  }
}

function toHex({ red, green, blue }: Rgba): string {
  const channel = (value: number) => value.toString(16).padStart(2, '0');
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

function findNearestOpaqueBackground(
  element: Element | null,
  readBackground: (element: Element) => string,
  rasterize: (color: string) => Rgba | null
): string | null {
  for (
    let current = element;
    current != null;
    current = current.parentElement
  ) {
    // A control crossing the viewport edge must not recolor the system bar.
    if (
      current.matches(
        'a, button, input, select, textarea, [role="button"], [role="link"]'
      )
    ) {
      continue;
    }
    const color = rasterize(readBackground(current));
    if (color != null && color.alpha >= OPAQUE_ALPHA) {
      return toHex(color);
    }
  }
  return null;
}

/** Sample the nearest opaque page surface at a viewport edge, then use the theme token. */
function readSurfaceHexAtViewportEdge(edge: 'top' | 'bottom'): string | null {
  try {
    const x = Math.max(0, Math.floor(window.innerWidth / 2));
    const y =
      edge === 'top'
        ? Math.max(0, Math.min(1, window.innerHeight - 1))
        : Math.max(0, Math.floor(window.innerHeight - 1));
    const hit = document.elementFromPoint(x, y);
    const sampled = findNearestOpaqueBackground(
      hit,
      element => window.getComputedStyle(element).backgroundColor,
      rasterizeCssColor
    );
    if (sampled != null) {
      return sampled;
    }

    const token = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(BACKGROUND_TOKEN)
      .trim();
    const fallback = rasterizeCssColor(token);
    return fallback != null && fallback.alpha >= OPAQUE_ALPHA
      ? toHex(fallback)
      : null;
  } catch {
    return null;
  }
}

/** Surface behind the status inset (often the public header, not the page canvas). */
export function readTopSurfaceHex(): string | null {
  return readSurfaceHexAtViewportEdge('top');
}

/** Surface behind the gesture-navigation inset, sampled independently from the top. */
export function readBottomSurfaceHex(): string | null {
  return readSurfaceHexAtViewportEdge('bottom');
}

/**
 * Capacitor's StatusBar API calls the white-icon appearance `DARK`. Choose the icon polarity
 * from relative luminance so fixed-color surfaces do not inherit the unrelated html data-mode.
 */
export function statusBarStyleForHex(
  color: string
): Exclude<StatusBarStyle, 'DEFAULT'> {
  const match = /^#([\da-f]{6})$/i.exec(color);
  if (match == null) {
    return 'LIGHT';
  }

  const channels = [0, 2, 4].map(
    offset => Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255
  );
  const [red, green, blue] = channels.map(channel =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return whiteContrast >= blackContrast ? 'DARK' : 'LIGHT';
}

/** Foreground color for the navigation gesture handle, independent of the top status icons. */
export function systemBarIconStyleForHex(color: string): 'light' | 'dark' {
  return statusBarStyleForHex(color) === 'DARK' ? 'light' : 'dark';
}
