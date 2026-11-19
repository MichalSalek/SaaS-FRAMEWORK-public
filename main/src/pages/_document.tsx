import { LP_ASSETS } from '../UI/assets/lpAssets';
import lpAssetsConfig from '../UI/assets/lp-assets.config.json';
import type { ReactElement } from 'react';
import Document, {
  Head,
  Html,
  Main,
  NextScript,
  type DocumentContext,
  type DocumentInitialProps,
} from 'next/document';
// ZERO_FLASH_SCRIPT (theme/FOUC bridge) + its CSP hash live in a lean SSOT module
// shared with proxy.ts (the CSP middleware). See zero-flash-script.ts for why.
import { ZERO_FLASH_SCRIPT } from '../application/client-device-storage/zero-flash-script';
// Consent Mode default as the first dataLayer entry (DECISION in the module;
// its CSP hash is pinned there and allowed by proxy.ts like ZERO_FLASH's).
import { CONSENT_DEFAULT_SCRIPT } from '../application/analytics/consent-default-script';
import { ENV_VARS } from '../application/environment/environment.config';
// The next/font variable classes go on <html> so --font-* reaches the WHOLE tree: <body>, base
// inheritance and portals mounted to document.body (modals, dialogs, overlays). Reason and
// measurement: application/fonts.ts.
import { FONT_VARIABLE_CLASSNAMES } from '../application/fonts';
import {
  inlinesCssForPage,
  readBuildCss,
} from '../application/document/inline-css';
import { CLOUDINARY_ASSET_URL_PREFIX } from '@kernel/policies/validation/validation.utils';

// Route PATTERNS (`__NEXT_DATA__.page`) whose first screen renders <img> tags
// pointing at res.cloudinary.com (GalleryPhotoCard, photo detail, sessions,
// salon and stylist profile galleries).
const IMAGE_CDN_ROUTE_PREFIXES = ['/app'] as const;
const IMAGE_CDN_ROUTES = new Set([
  '/stylist/[identifier]',
  '/salon/[id]',
  '/s/[slug]',
]);

function usesImageCdnOnFirstScreen(page: string): boolean {
  return (
    IMAGE_CDN_ROUTES.has(page) ||
    IMAGE_CDN_ROUTE_PREFIXES.some(
      prefix => page === prefix || page.startsWith(`${prefix}/`)
    )
  );
}

type DocumentFiles = Parameters<Head['getCssLinks']>[0];

/**
 * DECISION: public pages carry their whole stylesheet INLINE instead of 6-7 render-blocking
 * <link>s. `experimental.inlineCss` is App-Router-only in Next 16, and `optimizeCss` (critters)
 * prunes the `[data-theme=dark]` rules the prerendered <html> does not match (dark-mode flash).
 * Inlining the FULL files keeps every theme rule, so ZERO_FLASH still paints the right palette.
 *
 * The markup mirrors what the pages-router client expects:
 *  - `_app` (shared) files become plain `<style data-n-g>`, like the `<link data-n-g>` they replace;
 *  - page files become `<style data-n-href="/_next/static/css/…">`, the tag the client creates for
 *    CSS it fetches on a route change, so on the next navigation it finds them by href and toggles
 *    them with `media="x"` instead of refetching or leaving stale page CSS active
 *    (client/index.js onStart/onHeadCommit).
 * A file that cannot be read (or a route under LINKED_CSS_ROUTE_PREFIXES) falls back to Next's own
 * <link> markup.
 */
class InlineCssHead extends Head {
  override getCssLinks(files: DocumentFiles): ReactElement[] | null {
    const { __NEXT_DATA__, assetPrefix, cssAssetQueryString } = this.context;
    if (!inlinesCssForPage(__NEXT_DATA__.page)) {
      return super.getCssLinks(files);
    }

    const sharedFiles = new Set(files.sharedFiles);
    const nonceProps = this.props.nonce ? { nonce: this.props.nonce } : {};
    const inlined: ReactElement[] = [];
    const linked: string[] = [];
    for (const file of files.allFiles) {
      if (!file.endsWith('.css')) {
        continue;
      }
      const css = readBuildCss(file);
      if (css === null) {
        linked.push(file);
        continue;
      }
      const isShared = sharedFiles.has(file);
      const href = `${assetPrefix}/_next/${file}${cssAssetQueryString}`;
      inlined.push(
        <style
          key={file}
          {...nonceProps}
          {...(isShared ? { 'data-n-g': '' } : { 'data-n-href': href })}
          dangerouslySetInnerHTML={{ __html: css }}
        />
      );
    }

    // Unreadable files and CSS of dynamic imports stay Next's business.
    const rest = super.getCssLinks({
      ...files,
      allFiles: files.allFiles.filter(
        file => !file.endsWith('.css') || linked.includes(file)
      ),
    });
    const elements = [...inlined, ...(rest ?? [])];
    return elements.length === 0 ? null : elements;
  }
}

type AppDocumentProps = DocumentInitialProps & {
  nonce?: string;
  locale: string;
};

class AppDocument extends Document<AppDocumentProps> {
  static async getInitialProps(
    ctx: DocumentContext
  ): Promise<AppDocumentProps> {
    const initialProps = await Document.getInitialProps(ctx);
    // The nonce is set on the request by src/proxy.ts. For dynamic responses
    // (SSR, on-demand revalidation) it propagates here; for fully static
    // builds the request headers are unavailable and `nonce` is undefined —
    // in that case browsers fall back to the CSP 'unsafe-inline' directive,
    // which is ignored by CSP3 user agents when a nonce is present at the
    // response header level.
    const nonceHeader = ctx.req?.headers?.['x-nonce'];
    // Locale is provided by Next.js i18n routing (next.config.js: locales
    // pl/en/de, defaultLocale=pl). Reflected on <html lang> for WCAG 2.1 AA
    // (3.1.1 Language of Page) so screen readers pronounce content correctly.
    const locale = ctx.locale ?? 'pl';
    if (typeof nonceHeader === 'string' && nonceHeader.length > 0) {
      return { ...initialProps, nonce: nonceHeader, locale };
    }
    return { ...initialProps, locale };
  }

  render() {
    const { nonce, locale } = this.props;
    // Pre-launch SEO gate (defense in depth next to X-Robots-Tag from next.config.mjs).
    const shouldNoindex = !ENV_VARS.SEO_INDEXING_ENABLED;
    // Conditionally spread `nonce` so we never pass `nonce={undefined}` —
    // tsconfig has `exactOptionalPropertyTypes: true`, and Next.js types
    // declare `nonce` as optional `string` (not `string | undefined`).
    const nonceProps = nonce ? { nonce } : {};
    const usesImageCdn = usesImageCdnOnFirstScreen(
      this.props.__NEXT_DATA__.page
    );
    // data-scroll-behavior: Next suspends the global smooth scroll (global.css,
    // owner) during route transitions, so a new page starts at the top
    // instantly while anchors and scrollTo stay smooth.
    return (
      <Html
        lang={locale}
        className={FONT_VARIABLE_CLASSNAMES}
        data-scroll-behavior='smooth'>
        <InlineCssHead {...nonceProps}>
          <meta
            name='format-detection'
            content='telephone=no,date=no,email=no,address=no'
          />
          {}
          {/* Shared asset version refreshes browser-cached brand icons after
              permanent recoloring. The same version is used by the manifest. */}
          <link rel='icon' href={LP_ASSETS.seo.favicon} sizes='any' />
          <link
            rel='icon'
            type='image/png'
            sizes='192x192'
            href={LP_ASSETS.seo.icon192}
          />
          <link
            rel='icon'
            type='image/png'
            sizes='512x512'
            href={LP_ASSETS.seo.icon512}
          />
          <link
            rel='apple-touch-icon'
            sizes='180x180'
            href={LP_ASSETS.seo.appleTouchIcon}
          />
          <link
            rel='manifest'
            href={`/site.webmanifest?v=${lpAssetsConfig.version}`}
          />
          {shouldNoindex && <meta name='robots' content='noindex, nofollow' />}
          <meta
            name='theme-color'
            content='#f7f1e9'
            media='(prefers-color-scheme: light)'
          />
          <meta
            name='theme-color'
            content='#0f0d0a'
            media='(prefers-color-scheme: dark)'
          />
          {/* DECISION: the image-CDN preconnect is emitted ONLY on routes whose first screen draws
              photos straight from Cloudinary (`IMAGE_CDN_ROUTES`). Marketing pages draw local assets
              through `/_next/image` (the server fetches remote photos), so a sitewide preconnect
              opened a connection nothing used. It has NO crossOrigin: the photos are plain no-cors
              <img> requests, and a `crossOrigin='anonymous'` hint sits in a connection pool they
              never reuse. No js.stripe.com preconnect: Stripe.js loads through
              `@stripe/stripe-js/pure`, only when a checkout or an SCA step mounts. */}
          {usesImageCdn && (
            <link rel='preconnect' href={CLOUDINARY_ASSET_URL_PREFIX} />
          )}
          <script
            {...nonceProps}
            dangerouslySetInnerHTML={{ __html: ZERO_FLASH_SCRIPT }}
          />
          <script
            {...nonceProps}
            dangerouslySetInnerHTML={{ __html: CONSENT_DEFAULT_SCRIPT }}
          />
          {/* DECISION: the RSS <link> is NOT emitted globally. The /rss.xml feed is gated by the
              BLOG_ENABLED flag and returns 404 when the blog is parked, so a sitewide link would
              advertise a 404 feed. The link lives in PublicSeoHead (prop `rssFeed`) and is set only
              on /blog/* pages, where the feed exists. */}
        </InlineCssHead>
        <body>
          <Main />
          <NextScript {...nonceProps} />
        </body>
      </Html>
    );
  }
}

export default AppDocument;
