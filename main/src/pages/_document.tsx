import { LP_ASSETS } from '../UI/assets/lpAssets';
import lpAssetsConfig from '../UI/assets/lp-assets.config.json';
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
import { ENV_VARS } from '../application/environment/environment.config';
// Klasy ze zmiennymi next/font trafiają na <html>, żeby --font-* widziało CAŁE
// drzewo: <body>, dziedziczenie bazowe i portale montowane do document.body
// (modale/dialogi/overlaye). Powód i pomiar: application/fonts.ts.
import { FONT_VARIABLE_CLASSNAMES } from '../application/fonts';

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
    // Pre-launch SEO gate (defense-in-depth obok X-Robots-Tag z next.config.mjs).
    const shouldNoindex = !ENV_VARS.SEO_INDEXING_ENABLED;
    // Conditionally spread `nonce` so we never pass `nonce={undefined}` —
    // tsconfig has `exactOptionalPropertyTypes: true`, and Next.js types
    // declare `nonce` as optional `string` (not `string | undefined`).
    const nonceProps = nonce ? { nonce } : {};
    // data-scroll-behavior: Next suspends the global smooth scroll (global.css,
    // owner S82) during route transitions, so a new page starts at the top
    // instantly while anchors and scrollTo stay smooth.
    return (
      <Html
        lang={locale}
        className={FONT_VARIABLE_CLASSNAMES}
        data-scroll-behavior='smooth'>
        <Head {...nonceProps}>
          <meta
            name='format-detection'
            content='telephone=no,date=no,email=no,address=no'
          />
          {/* DECISION (nie usuwaj tego komentarza):
              Icons + PWA manifest. apple-touch-icon → ekran główny iOS; icon-192/512
              → Android/PWA; SSOT brand-marku = docs/DOMAIN/marketing/
              brand-sheet-nailfolio.png, z niego wygenerowany cały zestaw (spójność).
              manifest display:'standalone' + start_url '/app' (web-first D0,
              owner 2026-08-02) — „Dodaj do ekranu głównego" daje ikonę i
              pełnoekranowe okno („prawie-appka" bez sklepu). To NIE jest PWA:
              service workera i obietnic offline NADAL nie ma (decyzja zostaje).
              PREMIERA W GOOGLE PLAY (obowiązkowy flip, anty-dublet ikon):
              do site.webmanifest dodać related_applications
              [{platform:'play', id: BRAND_CONFIG.androidPackage}] +
              prefer_related_applications:true — Chrome przestanie oferować
              instalację WebAPK i wypromuje natywną apkę (dziś NIE dodawać:
              prefer=true przy braku appki w Play wyłącza beforeinstallprompt,
              czyli zabija przycisk A2HS na /welcome). Istniejące skróty
              WebAPK po premierze działają dalej (nieszkodliwe); linki przejmuje
              natywna apka przez verified App Links (assetlinks + Play-signing
              SHA — checklist: memory project_webfirst_d0).
              iOS: świadomie BEZ meta apple-mobile-web-app-capable i bez
              promowania A2HS — skrót home-screen na iOS ma IZOLOWANY storage
              (magic-link zaloguje Safari, a skrót zostanie wylogowany);
              iPhone = normalna karta Safari. Przycisk A2HS na /welcome działa
              tylko tam, gdzie jest beforeinstallprompt (Chrome/Android). */}
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
          <link
            rel='preconnect'
            href='https://res.cloudinary.com'
            crossOrigin='anonymous'
          />
          {/* DD3-F11: removed Google Fonts preconnect (fonts.googleapis.com + fonts.gstatic.com).
              next/font self-hosts WOFF2 + injects CSS inline — no runtime fetch to Google.
              Preconnect to dead origins wastes one DNS+TCP+TLS slot at HTML parse time. */}
          <link
            rel='preconnect'
            href='https://js.stripe.com'
            crossOrigin='anonymous'
          />
          <script
            {...nonceProps}
            dangerouslySetInnerHTML={{ __html: ZERO_FLASH_SCRIPT }}
          />
          {/* DECISION (nie usuwaj tego komentarza):
              RSS <link> NIE jest tu emitowany globalnie. Feed /rss.xml jest
              gate'owany flagą BLOG_ENABLED i zwraca 404 gdy blog jest zaparkowany
              — sitewide link = 404 na odkrywanym feedzie (fix MR360 1D-F4).
              Link żyje teraz w PublicSeoHead (prop `rssFeed`) i jest ustawiany
              tylko na stronach /blog/*, gdzie feed faktycznie istnieje. */}
        </Head>
        <body>
          <Main />
          <NextScript {...nonceProps} />
        </body>
      </Html>
    );
  }
}

export default AppDocument;
