import Image from 'next/image';
import { useEffect, useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import styles from './SectionOrnament.module.css';

/** A contextual drawing beside a section heading, outside its reading order. */
export function SectionOrnamentMolecule({
  src,
  children,
  className,
}: {
  src: string;
  children: ReactNode;
  className?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const content = contentRef.current;
    const drawing = drawingRef.current;
    if (!content || !drawing) {
      return;
    }
    const align = () => {
      const heading =
        content.querySelector('h1, h2, h3') ?? content.firstElementChild;
      if (!(heading instanceof HTMLElement)) {
        return;
      }
      const line = Number.parseFloat(getComputedStyle(heading).lineHeight);
      if (!Number.isFinite(line)) {
        return;
      }
      const top =
        heading.getBoundingClientRect().top -
        content.getBoundingClientRect().top;
      drawing.style.setProperty(
        '--ornament-offset',
        `${top + (line - drawing.offsetHeight) / 2}px`
      );
    };
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(align);
    observer?.observe(content);
    observer?.observe(drawing);
    window.addEventListener('resize', align);
    align();
    void document.fonts?.ready.then(align);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', align);
    };
  }, [children, src]);
  return (
    <div className={clsx(styles.layout, className)}>
      <div className={styles.content} ref={contentRef}>
        {children}
      </div>
      <div className={styles.drawing} ref={drawingRef} aria-hidden='true'>
        <Image src={src} alt='' width={160} height={160} />
      </div>
    </div>
  );
}
