// UI/features/account/components/ThemeSection.tsx
// Theme picker — light/dark/system mode toggle.
//
// Palette picker removed (single-theme production: rouge-papier is the sole
// brand palette as of 2026-05-11). Integrates with ThemeContext and applies
// via data-mode + color-scheme on <html>.
//
// Stack: CSS Modules + Phosphor Icons.

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  MoonIcon,
  PaletteIcon,
  SunIcon,
  DesktopIcon,
} from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { useTheme } from '../../../styles/ThemeContext.composition';
import styles from '../AccountPage.module.css';

/* ─── Mode options ─── */

type Mode = 'light' | 'dark' | 'system';

const MODE_ICONS: Record<Mode, typeof SunIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  system: DesktopIcon,
};

/* ─── Component ─── */

export function ThemeSectionOrganism() {
  const t = useTranslations('account.theme');
  const { mode, setMode } = useTheme();

  // DECISION (nie usuwaj — S18 hydration fix): `mode` pochodzi z localStorage
  // (client-only), wiec SSR (brak storage) renderuje inny aktywny przycisk niz
  // pierwszy client-render => hydration mismatch (aria-pressed/active-class).
  // Mount-gate: aktywny stan dopiero PO zamontowaniu, SSR i first-CSR renderuja
  // identycznie (brak aktywnego). NIE upraszczac z powrotem do `mode===value`.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const MODES: readonly { value: Mode; label: string; icon: typeof SunIcon }[] =
    [
      { value: 'light', label: t('modeLight'), icon: MODE_ICONS.light },
      { value: 'dark', label: t('modeDark'), icon: MODE_ICONS.dark },
      { value: 'system', label: t('modeSystem'), icon: MODE_ICONS.system },
    ];

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <PaletteIcon size={20} />
        <TypographyAtom variant='h4'>{t('sectionTitle')}</TypographyAtom>
      </div>

      {/* Light/Dark/System */}
      <div className={styles.modeRow}>
        <TypographyAtom variant='body2' className={styles.modeLabel}>
          {t('modeLabel')}
        </TypographyAtom>
        <div className={styles.modeButtons}>
          {MODES.map(opt => {
            const ModeIcon = opt.icon;
            const isActive = mounted && mode === opt.value;
            return (
              <button
                key={opt.value}
                type='button'
                className={clsx(styles.modeBtn, {
                  [styles.modeBtnActive ?? '']: isActive,
                })}
                onClick={() => setMode(opt.value)}
                aria-pressed={isActive}
                aria-label={opt.label}>
                <ModeIcon size={16} />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
