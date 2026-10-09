import Head from 'next/head';
import { AppLinkAtom as Link } from '../../UI/components/AppLink/AppLink.atom';
import type { GetStaticProps } from 'next';
import type { CSSProperties } from 'react';
import { getI18nMessages } from '../../application/i18n/i18n.loader';
import { ARE_DEV_ROUTES_ENABLED } from '../../application/environment/environment.possibilities.api';

/**
 * /dev — hub narzędzi deweloperskich (dev-only + staging, noindex).
 * Pojedyncze wejście do dev-podstron, żeby żadna nie była osierocona.
 * Self-contained (inline styles on product tokens); floor 7×ZERO.
 */

interface DevTool {
  href: string;
  title: string;
  desc: string;
}

const TOOLS: DevTool[] = [
  {
    href: '/dev/api',
    title: 'Mapa API',
    desc: 'Widok architekta: endpointy pogrupowane wg domen (plików .dto.ts), kontrakt zwinięty domyślnie. Generowane z DTO-SSOT — bez ręcznego utrzymania. Zasięg: wszystkie 18 domen. Regeneracja: npm run dev:gen-openapi.',
  },
  {
    href: '/dev/playground',
    title: 'Playground',
    desc: 'S94 głos kontrastu: 3 moduły z /pricing w 7 kierunkach (DZIŚ + A do F). Sprzątane po wyborze.',
  },
  {
    href: '/dev/ui',
    title: 'Biblioteka UI',
    desc: 'Katalog klepniętych komponentów współdzielonych: żywe rendery, status FROZEN/DRAFT, „kiedy używać".',
  },
];

const S = {
  page: {
    background: 'var(--color-bg-main)',
    color: 'var(--color-text-primary)',
    minHeight: '100vh',
    fontFamily: 'var(--font-body)',
    padding: 'clamp(var(--space-28), 6vw, var(--space-72))',
  } satisfies CSSProperties,
  kicker: {
    fontFamily: 'var(--style-kicker-font)',
    fontSize: 'var(--style-kicker-size)',
    fontWeight: 'var(--style-kicker-weight)' as CSSProperties['fontWeight'],
    letterSpacing: 'var(--style-kicker-tracking)',
    textTransform: 'var(--style-kicker-case)' as CSSProperties['textTransform'],
    color: 'var(--color-accent-fg)',
    marginBottom: 'var(--space-12)',
  } satisfies CSSProperties,
  h1: {
    fontFamily: 'var(--style-heading-font)',
    fontSize: 'var(--text-fluid-xl)',
    fontWeight: 'var(--style-heading-weight)' as CSSProperties['fontWeight'],
    letterSpacing: 'var(--style-heading-tracking)',
    margin: '0 0 var(--space-10)',
  } satisfies CSSProperties,
  sub: {
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--text-sm)',
    maxWidth: '60ch',
    margin: '0 0 var(--space-32)',
    lineHeight: 'var(--leading-body)',
  } satisfies CSSProperties,
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))',
    gap: 'var(--space-16)',
    maxWidth: 1000,
  } satisfies CSSProperties,
  card: {
    display: 'block',
    background: 'var(--color-surface-card)',
    border: 'var(--style-border-surface) solid var(--color-border)',
    borderRadius: 'var(--style-radius-surface)',
    padding: 'var(--space-24)',
    textDecoration: 'none',
    color: 'inherit',
  } satisfies CSSProperties,
  cardTitle: {
    fontFamily: 'var(--style-heading-font)',
    fontSize: 'var(--text-lg)',
    fontWeight: 'var(--style-heading-weight)' as CSSProperties['fontWeight'],
    color: 'var(--color-accent-fg)',
    margin: '0 0 var(--space-8)',
  } satisfies CSSProperties,
  cardDesc: {
    fontSize: 'var(--text-xs)',
    lineHeight: 'var(--leading-body)',
    color: 'var(--color-text-secondary)',
    margin: 0,
  } satisfies CSSProperties,
  cardHref: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    marginTop: 'var(--space-12)',
    display: 'block',
  } satisfies CSSProperties,
};

export default function DevHub() {
  return (
    <>
      <Head>
        <title>Dev — narzędzia</title>
        <meta name='robots' content='noindex,nofollow' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
      </Head>
      <div style={S.page}>
        <div style={S.kicker}>SaaS-FRAMEWORK: dev</div>
        <h1 style={S.h1}>Narzędzia deweloperskie</h1>
        <p style={S.sub}>
          Strony dostępne tylko na środowiskach DEVELOPMENT i STAGING (na
          preview i produkcji zwracają 404). Wszystkie noindex.
        </p>
        <div style={S.grid}>
          {TOOLS.map(tool => (
            <Link key={tool.href} href={tool.href} style={S.card}>
              <div style={S.cardTitle}>{tool.title}</div>
              <p style={S.cardDesc}>{tool.desc}</p>
              <span style={S.cardHref}>{tool.href}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}

export const getStaticProps: GetStaticProps = async ({ locale }) => {
  if (!ARE_DEV_ROUTES_ENABLED()) {
    return { notFound: true };
  }
  const resolved = locale ?? 'pl';
  const messages = await getI18nMessages(resolved);
  return { props: { messages } };
};
