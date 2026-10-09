import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CameraIcon } from '@phosphor-icons/react';
import styles from './UploadTipRotator.module.css';

/** Keys under `pages.gallery.uploadTips`. The order of appearance is drawn anew on every entry. */
const TIP_KEYS = [
  't01',
  't02',
  't03',
  't04',
  't05',
  't06',
  't07',
  't08',
  't09',
  't10',
  't11',
  't12',
  't13',
  't14',
  't15',
  't16',
  't17',
  't18',
  't19',
  't20',
  't21',
] as const;

const ROTATE_EVERY_MS = 12_000;

/** Fisher–Yates over the tip indexes: every tip once before any repeats. */
function shuffledOrder(): number[] {
  const order = TIP_KEYS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const held = order[i] as number;
    order[i] = order[j] as number;
    order[j] = held;
  }
  return order;
}

/**
 * Photo tips shown while the stylist picks and frames a photo; one tip at a
 * time, in an order drawn on every entry, the next one fading in slowly.
 *
 * DECISION (nie usuwaj tego komentarza) — zgłoszenia ownera 2026-10-08:
 * (1) every tip is rendered into ONE grid cell and only opacity changes. The
 * cell takes the height of the tallest tip in the active language, so a
 * rotation never moves the crop frame or the drop zone below it. (2) The order
 * is RANDOM per entry and a tip stays 12 s: the owner expected a different tip
 * per visit, and a change every 6 s read as restless („zmienia się za szybko”).
 * The order is drawn in an effect, not during render: a random value in render
 * differs between the server HTML and the first client render. Until then no
 * tip is shown; the cell already has its height, so nothing moves. (3) Tips
 * align to the TOP of the cell and the icon box is exactly one text line tall:
 * with the tips centred in a cell sized by the longest one, a one-line tip sat
 * half a line below its icon („ikonka jest mega wyżej od tekstu”). No
 * `aria-live`: a region announcing a new sentence over and over would talk
 * over the screen reader for the whole step.
 */
export function UploadTipRotatorMolecule() {
  const t = useTranslations('pages.gallery.uploadTips');
  const [order, setOrder] = useState<readonly number[] | null>(null);
  const [position, setPosition] = useState(0);

  useEffect(() => {
    setOrder(shuffledOrder());
    const tick = () => {
      // A hidden tab keeps its place, so the stylist returns to the tip she left.
      if (document.visibilityState === 'visible') {
        setPosition(current => (current + 1) % TIP_KEYS.length);
      }
    };
    const id = window.setInterval(tick, ROTATE_EVERY_MS);
    return () => window.clearInterval(id);
  }, []);

  const index = order === null ? -1 : (order[position] ?? -1);

  return (
    <div className={styles.rotator}>
      <span className={styles.icon} aria-hidden='true'>
        <CameraIcon size={16} weight='fill' />
      </span>
      <div className={styles.stack}>
        {TIP_KEYS.map((key, i) => (
          <p
            key={key}
            className={styles.tip}
            data-active={i === index ? '' : undefined}
            aria-hidden={i === index ? undefined : true}>
            {t(key)}
          </p>
        ))}
      </div>
    </div>
  );
}
