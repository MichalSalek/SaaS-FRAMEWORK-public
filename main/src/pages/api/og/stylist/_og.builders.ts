import { LP_ASSETS } from '../../../../UI/assets/lpAssets';
/**
 * OG card JSX builders for the stylist dynamic OG endpoint.
 *
 * Uses React.createElement (not JSX) because this file runs in a Node.js
 * API route — no JSX transform is needed when using createElement directly.
 * satori (used by @vercel/og under the hood) accepts React elements.
 */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SEO_CONFIG } from '@kernel/policies/seo.policy';

// ─── Brand constants (rouge-papier theme) ───────────────────────────────────
// Hex equivalents of the fuchsia dark primary/accent-fg roles.
// CSS variables are not available in Node.js API routes.
// Source of truth: main/src/UI/styles/themes/palettes.css (rouge-papier dark).
// Dark background chosen so the card has premium look on all social platforms.
export const BRAND = {
  bgMain: '#0f0d0a',
  bgCard: '#1c1a18',
  accent: '#fc7bb9',
  accentText: '#ff98c7',
  textPrimary: '#efece8',
  textSecondary: '#c0bdb9',
  border: '#6e6b68',
} as const;

// OG image dimensions — standard for Facebook, Twitter/X, LinkedIn, WhatsApp
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export type StylistOgData = {
  display_name: string | null;
  address_city: string | null;
  avatar_url: string | null;
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

function buildNailfolioLogo(): React.ReactElement {
  return React.createElement(
    'div',
    { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
    React.createElement('img', {
      src: getLogoSrc(),
      width: 32,
      height: 32,
      style: {
        objectFit: 'contain' as const,
        flexShrink: 0,
      },
    }),
    React.createElement(
      'span',
      {
        style: {
          fontFamily: 'sans-serif',
          fontSize: '28px',
          fontWeight: 700,
          color: BRAND.textPrimary,
          letterSpacing: '-0.02em',
        },
      },
      'Nailfolio'
    )
  );
}

function buildFooter(): React.ReactElement {
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
      style: { width: '48px', height: '2px', background: BRAND.accent },
    }),
    React.createElement(
      'span',
      {
        style: {
          fontSize: '20px',
          color: BRAND.accentText,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase' as const,
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
        background: BRAND.bgMain,
        padding: '64px 80px',
        fontFamily: 'sans-serif',
        boxSizing: 'border-box',
      },
    },
    buildNailfolioLogo(),
    React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
      React.createElement(
        'h1',
        {
          style: {
            fontFamily: 'sans-serif',
            fontSize: '72px',
            fontWeight: 700,
            color: BRAND.textPrimary,
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
            color: BRAND.textSecondary,
            margin: 0,
            lineHeight: 1.4,
          },
        },
        'Galerie stylizacji paznokci, style i inspiracje'
      )
    ),
    buildFooter()
  );
}

function buildAvatar(data: StylistOgData, name: string): React.ReactElement {
  if (data.avatar_url) {
    return React.createElement('img', {
      src: data.avatar_url,
      width: 180,
      height: 180,
      style: {
        borderRadius: '50%',
        objectFit: 'cover' as const,
        border: `3px solid ${BRAND.accent}`,
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
        background: BRAND.bgCard,
        border: `3px solid ${BRAND.accent}`,
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
          color: BRAND.accentText,
          fontFamily: 'sans-serif',
          fontWeight: 700,
        },
      },
      name.charAt(0).toUpperCase()
    )
  );
}

function buildNameBlock(name: string, city: string | null): React.ReactElement {
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
          fontFamily: 'sans-serif',
          fontSize: '64px',
          fontWeight: 700,
          color: BRAND.textPrimary,
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
              color: BRAND.textSecondary,
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            },
          },
          React.createElement('span', {
            style: {
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: BRAND.accent,
              // satori (silnik @vercel/og) NIE akceptuje display:inline-block —
              // odrzuca CAŁY render → endpoint zawsze fallbackował 302 na
              // static (dynamic per-stylist OG MARTWY, S82-seo). flex = leaf OK.
              display: 'flex',
              flexShrink: 0,
            },
          }),
          city
        )
      : null,
    React.createElement(
      'p',
      {
        style: {
          fontSize: '24px',
          color: BRAND.accentText,
          margin: 0,
          fontWeight: 500,
        },
      },
      'Stylistka paznokci'
    )
  );
}

export function buildStylistOgCard(data: StylistOgData): React.ReactElement {
  const name = data.display_name ?? 'Stylistka paznokci';

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: `${OG_WIDTH}px`,
        height: `${OG_HEIGHT}px`,
        background: BRAND.bgMain,
        padding: '64px 80px',
        fontFamily: 'sans-serif',
        boxSizing: 'border-box',
      },
    },
    buildNailfolioLogo(),
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
      buildAvatar(data, name),
      buildNameBlock(name, data.address_city)
    ),
    buildFooter()
  );
}
