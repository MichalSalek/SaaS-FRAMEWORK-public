// DECISION: while the variant-C authCode exchange is in flight, this neutral full-viewport
// placeholder renders INSTEAD of `children`, so no page/guard mounts and evaluates isLoggedIn
// against a not-yet-exchanged token. It is deliberately framework-free (inline styles, no i18n, no
// design-system import) because it renders before any provider below AuthProvider, and it flashes
// only for ~1 round trip on the single post-login redirect. The spinner keyframe is inlined;
// `aria-busy` announces the transient state.
//
// DECISION: theme-flash safe. The background uses `--color-bg-main`, set render-blocking by
// ZERO_FLASH_SCRIPT in _document.tsx (it reads localStorage and sets data-theme/data-mode on <html>
// before React hydrates), so the token is resolved on :root before the first paint without waiting
// for ThemeProviderComposition (mounted BELOW AuthProvider). The var() fallbacks are deliberately
// not a light literal (a light hex flashed white for dark-mode users if the cascade ever failed to
// resolve the token): the background falls to `transparent` (the correct <body> background shows
// through) and the spinner color to inherited `currentColor`.
export function AuthCodeBootstrapFallbackComposition() {
  return (
    <div
      aria-busy='true'
      aria-live='polite'
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-main, transparent)',
        color: 'var(--color-text-primary, currentColor)',
        zIndex: 9999,
      }}>
      <span
        aria-hidden='true'
        className='nf-auth-code-spinner'
        style={{
          width: 28,
          height: 28,
          borderRadius: 'var(--style-radius-round)',
          animation: 'authCodeBootstrapSpin 0.7s linear infinite',
          opacity: 0.55,
        }}
      />
      <style>{`
        .nf-auth-code-spinner{border:2px solid transparent;border-top-color:currentColor}
        @supports (color: oklch(0% 0 0)) and (color: color-mix(in oklch, white, black)){
          .nf-auth-code-spinner{border-color:color-mix(in oklch,currentColor 24%,transparent);border-top-color:currentColor}
        }
        @keyframes authCodeBootstrapSpin{to{transform:rotate(360deg)}}
      `}</style>
    </div>
  );
}
