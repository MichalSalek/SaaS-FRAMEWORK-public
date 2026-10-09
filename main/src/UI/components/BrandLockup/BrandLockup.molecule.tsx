import clsx from 'clsx';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { BrandMarkAtom } from '../BrandMark/BrandMark.atom';
import styles from './BrandLockup.module.css';

export interface BrandLockupMoleculeProps {
  /** Klasa na cały lockup (rozmiar fontu wordmarku dziedziczy `em` na sygnecie). */
  className?: string;
  /** Nadpis rozmiaru sygnetu, gdy rodzic nie steruje font-size lockupu. */
  markClassName?: string;
  wordmarkClassName?: string;
}

/**
 * BrandLockupMolecule — SSOT pary sygnet + wordmark „Nailfolio".
 *
 * Navbar, rail konta, rail admina, login, welcome, maintenance renderują
 * markę TĄ SAMĄ formą: heading-font obok znaku nf, NIGDY pastylka/chip.
 * Sygnet sam (stopka, ekran bez nazwy) zostaje na BrandMarkAtom.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Owner S88: chip z nazwą marki pod logo = AI-slop. Nazwa w lockupie ma
 * być tym samym co w headingu (Marcellus), nie uppercase-pigułką linijkę
 * niżej. Chip/badge zostaje TYLKO gdy koduje stan, filtr albo liczbę.
 */
export function BrandLockupMolecule({
  className,
  markClassName,
  wordmarkClassName,
}: BrandLockupMoleculeProps) {
  return (
    <span className={clsx(styles.lockup, className)}>
      <BrandMarkAtom className={clsx(styles.mark, markClassName)} />
      <span className={clsx(styles.wordmark, wordmarkClassName)}>
        {BRAND_CONFIG.name}
      </span>
    </span>
  );
}
