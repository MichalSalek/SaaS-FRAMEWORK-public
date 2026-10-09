// UI/features/client/ClientProfilePreferences.organism.tsx
// „Twoje preferencje”: three chip groups (colours, lengths, styles).
//
// NOT RENDERED today: see the DECISION next to CLIENT_PREFERENCES_ENABLED in
// clientProfile.config.ts. The selections below are local state only; nothing
// is saved, which is exactly why the section is switched off.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import { ColorDotAtom } from '../../components/ColorDot/ColorDot.atom';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import styles from './ClientProfilePage.module.css';

// prettier-ignore
const COLOR_KEYS: readonly string[] = Object.freeze(['nude','pastel','classicRed','bold','earthy','metallic','dark','neon']);
const LENGTH_KEYS: readonly string[] = Object.freeze([
  NAIL_LENGTHS.SHORT,
  NAIL_LENGTHS.MEDIUM,
  NAIL_LENGTHS.LONG,
  NAIL_LENGTHS.XL,
]);
// prettier-ignore
const STYLE_KEYS: readonly string[] = Object.freeze(['minimal','french','ombre','art','luxe','natural','edgy','wedding']);

/* DECISION (nie usuwaj tego komentarza):
 * Representative swatch hex per colour-palette bucket. These are DATA colours
 * (what the manicure palette looks like), not UI chrome — hence literal hex,
 * not theme tokens. Keep the keys in sync with COLOR_KEYS above. */
// prettier-ignore
const PALETTE_SWATCH_HEX: Readonly<Record<string, string>> = Object.freeze({
  nude: '#d8ae93',
  pastel: '#f3c6d3',
  classicRed: '#c1121f',
  bold: '#7b2cbf',
  earthy: '#8d5b3f',
  metallic: '#b8bcc6',
  dark: '#2e1f33',
  neon: '#ff2d87',
});

type Selection = ReadonlySet<string>;

function toggled(prev: Selection, value: string): Selection {
  const next = new Set(prev);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

export function ClientProfilePreferencesOrganism() {
  const t = useTranslations('pages.clientProfile');
  const lang = useCurrentLang();
  const [colors, setColors] = useState<Selection>(() => new Set<string>());
  const [lengths, setLengths] = useState<Selection>(() => new Set<string>());
  const [looks, setLooks] = useState<Selection>(() => new Set<string>());

  return (
    <section className={styles.card}>
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t('preferencesTitle')}</h2>
        <p className={styles.sectionHint}>{t('preferencesSubtitle')}</p>
      </header>

      <ChipGroup
        label={t('preferencesColorsLabel')}
        helper={t('preferencesColorsHelper')}
        keys={COLOR_KEYS}
        selected={colors}
        getLabel={k => t(`colorPalettes.${k}`)}
        getDotColor={k => PALETTE_SWATCH_HEX[k]}
        onToggle={k => setColors(prev => toggled(prev, k))}
      />
      <ChipGroup
        label={t('preferencesLengthsLabel')}
        helper={t('preferencesLengthsHelper')}
        keys={LENGTH_KEYS}
        selected={lengths}
        getLabel={k => t(`nailLengths.${k}`)}
        onToggle={k => setLengths(prev => toggled(prev, k))}
      />
      <ChipGroup
        label={t('preferencesStylesLabel')}
        helper={t('preferencesStylesHelper')}
        keys={STYLE_KEYS}
        selected={looks}
        getLabel={k => t(`styles.${k}`)}
        onToggle={k => setLooks(prev => toggled(prev, k))}
      />

      <p className={styles.preferencesNote} lang={lang}>
        {t('preferencesNote')}
      </p>
    </section>
  );
}

interface ChipGroupProps {
  label: string;
  helper: string;
  keys: readonly string[];
  selected: Selection;
  getLabel: (key: string) => string;
  /** Colour palettes only: the chip shows the real swatch. */
  getDotColor?: (key: string) => string | undefined;
  onToggle: (key: string) => void;
}

function ChipGroup({
  label,
  helper,
  keys,
  selected,
  getLabel,
  getDotColor,
  onToggle,
}: ChipGroupProps) {
  return (
    <div className={styles.chipGroup}>
      <p className={styles.chipGroupLabel}>{label}</p>
      <p className={styles.sectionHint}>{helper}</p>
      <div className={styles.chipRow} role='group' aria-label={label}>
        {keys.map(key => {
          const active = selected.has(key);
          const dotColor = getDotColor?.(key);
          return (
            <button
              key={key}
              type='button'
              role='switch'
              aria-checked={active}
              className={`${styles.chip} ${active ? styles.chipActive : ''} haptic-press`}
              onClick={() => onToggle(key)}>
              {dotColor !== undefined && (
                <ColorDotAtom color={dotColor} size='sm' />
              )}
              {getLabel(key)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
