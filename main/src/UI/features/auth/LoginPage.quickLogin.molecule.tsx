// LoginPage.quickLogin.molecule.tsx — DEVELOPMENT-only dev-login tiles.
// Split from LoginPage.parts to keep each file under 300 lines.

import { UserIcon, ShieldCheckIcon } from '@phosphor-icons/react';
import { QUICK_LOGIN_TILES, type QuickLoginTile } from './LoginPage.tiles';
import type { LoginT } from './LoginPage.parts.molecule';
import styles from './LoginPage.module.css';

interface QuickLoginPanelProps {
  isSubmitting: boolean;
  onQuickLogin: (tile: QuickLoginTile) => void;
  t: LoginT;
}

export function QuickLoginPanelMolecule({
  isSubmitting,
  onQuickLogin,
  t,
}: QuickLoginPanelProps) {
  return (
    <div>
      <p className={styles.protoLabel}>{t('quickLoginLabel')}</p>
      <div
        className={styles.quickLoginGrid}
        role='group'
        aria-label={t('quickLoginAriaLabel')}>
        {QUICK_LOGIN_TILES.map(tile => (
          <button
            key={tile.email}
            type='button'
            className={styles.quickLoginTile}
            onClick={() => onQuickLogin(tile)}
            disabled={isSubmitting}
            aria-label={t('quickLoginTileAriaLabel', {
              label: tile.label,
              sublabel: tile.sublabel,
            })}>
            <span className={styles.tileIcon} aria-hidden='true'>
              {tile.variant === 'admin' ? (
                <ShieldCheckIcon size={20} />
              ) : (
                <UserIcon size={20} />
              )}
            </span>
            <span className={styles.tileText}>
              <span className={styles.tileName}>{tile.label}</span>
              <span className={styles.tileSub}>{tile.sublabel}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
