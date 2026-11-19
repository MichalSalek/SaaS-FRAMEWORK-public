import { useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { trackDemoInteraction } from '../../../../application/analytics/cta-events';
import { DEMO_WORKS } from './galleryFilterDemo.data';
import styles from './SessionPickDemo.module.css';

const WORKS = DEMO_WORKS.slice(0, 6);
const EMPTY_SLOTS = ['a', 'b', 'c'] as const;

interface SessionPickDemoProps {
  className?: string;
}

export function SessionPickDemoOrganism({ className }: SessionPickDemoProps) {
  const t = useTranslations('components.lpScenes.sessionPick');
  const tScene = useTranslations('components.lpScenes.phoneScene');
  const [picked, setPicked] = useState<readonly string[]>([]);
  const hasPicks = picked.length > 0;

  const toggle = (id: string) => {
    if (picked.includes(id)) {
      setPicked(picked.filter(current => current !== id));
      return;
    }
    const next = [...picked, id];
    // „Does she play with it, and how far”: once per count per page view
    // (the function keeps that promise itself).
    trackDemoInteraction('session-pick', 'photo_tap', String(next.length));
    setPicked(next);
  };

  return (
    <div className={clsx(styles.demo, className)}>
      <ul className={styles.grid} aria-label={t('listLabel')}>
        {WORKS.map((work, index) => {
          const order = picked.indexOf(work.id);
          const isPicked = order !== -1;
          return (
            <li key={work.id} className={styles.cell}>
              <button
                type='button'
                className={clsx(styles.tile, 'press-feedback')}
                aria-pressed={isPicked}
                aria-label={t('photo', { n: index + 1 })}
                onClick={() => toggle(work.id)}>
                <Image
                  src={work.src}
                  alt=''
                  fill
                  sizes='(max-width: 599px) 33vw, 190px'
                  className={styles.photo}
                />
                <span
                  className={styles.mark}
                  data-on={isPicked ? 'true' : undefined}
                  aria-hidden='true'>
                  {isPicked ? order + 1 : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div
        className={styles.card}
        role='status'
        aria-label={t('cardLabel')}
        data-ready={hasPicks ? 'true' : undefined}>
        <span className={styles.thumbs} aria-hidden='true'>
          {/* An empty card shows three empty photo slots: a plain grey
              strip was taken by readers for an image that failed to load. */}
          {!hasPicks &&
            EMPTY_SLOTS.map(slot => (
              <span key={slot} className={styles.thumb} data-empty='true' />
            ))}
          {picked.map(id => {
            const work = WORKS.find(item => item.id === id);
            return work === undefined ? null : (
              <span key={id} className={styles.thumb}>
                <Image
                  src={work.src}
                  alt=''
                  fill
                  sizes='44px'
                  className={styles.photo}
                />
              </span>
            );
          })}
        </span>
        <span className={styles.cardText}>
          <span className={styles.cardTitle}>{tScene('sessionTitle')}</span>
          <span className={styles.cardMeta}>
            <span
              className={styles.cardMetaLine}
              data-on={!hasPicks || undefined}
              aria-hidden={hasPicks || undefined}>
              {t('hint')}
            </span>
            <span
              className={styles.cardMetaLine}
              data-on={hasPicks || undefined}
              aria-hidden={!hasPicks || undefined}>
              {t('count', { count: Math.max(picked.length, 1) })}
            </span>
          </span>
          <span
            className={styles.cardNote}
            data-on={hasPicks || undefined}
            aria-hidden={!hasPicks || undefined}>
            {t('note')}
          </span>
        </span>
      </div>
    </div>
  );
}
