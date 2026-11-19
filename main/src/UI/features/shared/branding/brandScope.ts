// UI/features/shared/branding/brandScope.ts
// The brand colour of a stylist or a salon takes over the accent of THEIR
// public page (rule and DECISION: brandScope.module.css). One helper for every
// page that shows a branded account, so a new surface cannot invent its own.

import type { CSSProperties } from 'react';
import { isBrandAccentHex } from '@kernel/domain/user-and-account/branding.config';
import { colorVariableStyle } from '../../../../application/colors/color-css-variables';
import styles from './brandScope.module.css';

export type BrandScopeProps = {
  className?: string;
  style?: CSSProperties;
  'data-branded'?: '';
};

/** Props for the root element of a branded page: the page's own class plus
 *  the brand scope when the colour is valid. The value is checked against the
 *  curated palette again at render: the write path validates it, the render
 *  does not trust the database blindly. */
export function brandScopeProps(
  color: string | null | undefined,
  className?: string
): BrandScopeProps {
  if (!color || !isBrandAccentHex(color)) {
    return className ? { className } : {};
  }
  return {
    className: [className, styles.scope].filter(Boolean).join(' '),
    style: colorVariableStyle('--brand-accent', color),
    'data-branded': '',
  };
}
