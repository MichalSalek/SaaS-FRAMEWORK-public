import { useEffect, useRef, useState } from 'react';
import styles from './Playground.module.css';

export type PlaygroundMode = 'light' | 'dark';

const PHONE_HEIGHT = 844;
const DESKTOP_HEIGHT = 900;
const DESKTOP_FROM = 1024;

/**
 * One live route in a same-origin iframe at a real CSS width, so media
 * queries, safe-area math and sticky bars behave as on the device width.
 * Wider frames are scaled down to fit; the page inside still sees full width.
 */
export function PlaygroundFrameOrganism({
  src,
  width,
  mode,
  title,
  loading,
}: {
  src: string;
  width: number;
  mode: PlaygroundMode;
  title: string;
  /** `lazy` for long rows (a palette vote frames dozens of pages at once). */
  loading: 'eager' | 'lazy';
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [loaded, setLoaded] = useState(false);
  // Not `document`: the name shadowed the host page's global inside this file.
  const [frameDocument, setFrameDocument] = useState<Document | null>(null);
  const height = width >= DESKTOP_FROM ? DESKTOP_HEIGHT : PHONE_HEIGHT;

  // Phone widths scroll sideways at 1:1; desktop widths stack and shrink to
  // the row, because a 1440 px page is judged whole, not through a slot.
  useEffect(() => {
    const row = box.current?.closest('[data-frames]');
    if (!(row instanceof HTMLElement) || width < DESKTOP_FROM) {
      setScale(1);
      return;
    }
    const observer = new ResizeObserver(() => {
      setScale(Math.min(1, row.clientWidth / width));
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [width]);

  useEffect(() => {
    setLoaded(false);
  }, [src]);

  // The framed app resolves its own mode from shared localStorage and may set
  // it again after hydration; hold the preview mode without writing storage,
  // so switching here never changes the owner's real preference.
  useEffect(() => {
    const root = frameDocument?.documentElement;
    if (!root) {
      return;
    }
    const apply = () => {
      if (root.getAttribute('data-mode') !== mode) {
        root.setAttribute('data-mode', mode);
        root.style.colorScheme = mode;
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributeFilter: ['data-mode'] });
    return () => observer.disconnect();
  }, [frameDocument, mode]);

  return (
    <div
      ref={box}
      className={styles.frameBox}
      style={{ width: width * scale, height: height * scale }}>
      {!loaded && (
        <p className={styles.frameStatus} role='status'>
          Ładowanie podglądu
        </p>
      )}
      <iframe
        ref={frame}
        src={src}
        title={title}
        width={width}
        height={height}
        className={styles.frame}
        loading={loading}
        style={{ transform: `scale(${scale})` }}
        onLoad={() => {
          setLoaded(true);
          setFrameDocument(frame.current?.contentDocument ?? null);
        }}
      />
    </div>
  );
}
