import { LP_ASSETS } from '../../../assets/lpAssets';
/**
 * OG card JSX builders for the stylist dynamic OG endpoint
 * (pages/api/og/stylist/[identifier].ts).
 *
 * Uses React.createElement (not JSX) because this file runs in a Node.js
 * API route — no JSX transform is needed when using createElement directly.
 * satori (used by @vercel/og under the hood) accepts React elements.
 */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SEO_CONFIG } from '@kernel/policies/seo.policy';
import { DEFAULT_OG_THEME, resolveOgTheme, type OgTheme } from './ogCard.theme';

// OG image dimensions — standard for Facebook, Twitter/X, LinkedIn, WhatsApp
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

// Brand face, loaded by the route at 500 and 600 only (DECISION in
// [identifier].ts): headings take 600, running text 500, like the site.
export const OG_FONT_FAMILY = 'Schibsted Grotesk';
// The wordmark beside the nf mark, as in BrandLockupMolecule (one weight, 400).
export const OG_WORDMARK_FONT_FAMILY = 'Marcellus';

export type StylistOgData = {
  display_name: string | null;
  address_city: string | null;
  avatar_url: string | null;
  // Plan-masked by the backend (null without can_brand_profile).
  brand_accent_color: string | null;
};

// Prawdziwy sygnet nf (brand-sheet 2026-07-16) zamiast dawnej atrapy
// (gradientowy romb = floor §1). Data-URI z dysku (deterministyczne, zero
// zależności sieciowej w satori); gdy public/ niedostępne w bundlu
// (standalone edge-case) — fallback na absolutny URL, satori dociągnie sam.
let logoSrcCache: string | null = null;
function getLogoSrc(): string {
  if (logoSrcCache === null) {
    try {
      const buf = readFileSync(join(process.cwd(), 'public', 'logo.png'));
      logoSrcCache = `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
      logoSrcCache = `${SEO_CONFIG.domain}${LP_ASSETS.seo.logo}`;
    }
  }
  return logoSrcCache;
}

function buildNailfolioLogo(theme: OgTheme): React.ReactElement {
  return React.createElement(
    'div',
    { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
    theme.showLogoMark
      ? React.createElement('img', {
          src: getLogoSrc(),
          width: 32,
          height: 32,
          style: {
            objectFit: 'contain' as const,
            flexShrink: 0,
          },
        })
      : null,
    React.createElement(
      'span',
      {
        style: {
          fontFamily: OG_WORDMARK_FONT_FAMILY,
          fontSize: '30px',
          fontWeight: 400,
          color: theme.showLogoMark ? theme.textPrimary : theme.textSecondary,
          letterSpacing: '-0.01em',
        },
      },
      'Nailfolio'
    )
  );
}

function buildFooter(theme: OgTheme): React.ReactElement {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        paddingTop: '20px',
      },
    },
    React.createElement('div', {
      style: { width: '48px', height: '2px', background: theme.accent },
    }),
    React.createElement(
      'span',
      {
        style: {
          fontSize: '20px',
          color: theme.accentText,
          fontWeight: 600,
        },
      },
      SEO_CONFIG.domain.replace('https://', '')
    )
  );
}

export function buildGenericOgCard(): React.ReactElement {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: `${OG_WIDTH}px`,
        height: `${OG_HEIGHT}px`,
        background: DEFAULT_OG_THEME.bgMain,
        padding: '64px 80px',
        fontFamily: OG_FONT_FAMILY,
        boxSizing: 'border-box',
      },
    },
    buildNailfolioLogo(DEFAULT_OG_THEME),
    React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
      React.createElement(
        'h1',
        {
          style: {
            fontFamily: OG_FONT_FAMILY,
            fontSize: '72px',
            fontWeight: 600,
            color: DEFAULT_OG_THEME.textPrimary,
            margin: 0,
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
          },
        },
        'Portfolio paznokci online'
      ),
      React.createElement(
        'p',
        {
          style: {
            fontSize: '32px',
            color: DEFAULT_OG_THEME.textSecondary,
            margin: 0,
            fontWeight: 500,
            lineHeight: 1.4,
          },
        },
        'Galerie stylizacji paznokci, style i inspiracje'
      )
    ),
    buildFooter(DEFAULT_OG_THEME)
  );
}

function buildAvatar(
  data: StylistOgData,
  name: string,
  theme: OgTheme
): React.ReactElement {
  if (data.avatar_url) {
    return React.createElement('img', {
      src: data.avatar_url,
      width: 180,
      height: 180,
      style: {
        borderRadius: '50%',
        objectFit: 'cover' as const,
        border: `3px solid ${theme.accent}`,
        flexShrink: 0,
      },
    });
  }
  return React.createElement(
    'div',
    {
      style: {
        width: '180px',
        height: '180px',
        borderRadius: '50%',
        background: theme.bgCard,
        border: `3px solid ${theme.accent}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      },
    },
    React.createElement(
      'span',
      {
        style: {
          fontSize: '72px',
          color: theme.accentText,
          fontFamily: OG_FONT_FAMILY,
          fontWeight: 600,
        },
      },
      name.charAt(0).toUpperCase()
    )
  );
}

function buildNameBlock(
  name: string,
  city: string | null,
  roleLabel: string | null,
  theme: OgTheme
): React.ReactElement {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        flex: 1,
        minWidth: 0,
      },
    },
    React.createElement(
      'h1',
      {
        style: {
          fontFamily: OG_FONT_FAMILY,
          fontSize: '64px',
          fontWeight: 600,
          color: theme.textPrimary,
          margin: 0,
          lineHeight: 1.1,
          letterSpacing: '-0.03em',
          whiteSpace: 'nowrap' as const,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        },
      },
      name
    ),
    city
      ? React.createElement(
          'p',
          {
            style: {
              fontSize: '30px',
              color: theme.textSecondary,
              margin: 0,
              fontWeight: 500,
              display: 'flex',
            },
          },
          city
        )
      : null,
    roleLabel
      ? React.createElement(
          'p',
          {
            style: {
              fontSize: '24px',
              color: theme.accentText,
              margin: 0,
              fontWeight: 500,
            },
          },
          roleLabel
        )
      : null
  );
}

/**
 * `roleLabel` is the profession in the profile page's locale (the route passes
 * the same word the page's meta uses), so an EN or DE share does not carry a
 * Polish card. It also stands in for a missing name, and then the line under
 * the name is dropped so the card does not say the same word twice.
 */
export function buildStylistOgCard(
  data: StylistOgData,
  roleLabel: string
): React.ReactElement {
  const name = data.display_name ?? roleLabel;
  const theme = resolveOgTheme(data.brand_accent_color);

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: `${OG_WIDTH}px`,
        height: `${OG_HEIGHT}px`,
        background: theme.bgMain,
        padding: '64px 80px',
        fontFamily: OG_FONT_FAMILY,
        boxSizing: 'border-box',
      },
    },
    buildNailfolioLogo(theme),
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '48px',
          flex: 1,
          paddingTop: '40px',
          paddingBottom: '32px',
        },
      },
      buildAvatar(data, name, theme),
      buildNameBlock(
        name,
        data.address_city,
        data.display_name ? roleLabel : null,
        theme
      )
    ),
    buildFooter(theme)
  );
}
