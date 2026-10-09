# Native Integration Guide — Next.js + Capacitor Wrapper

> SSOT for how the Next.js frontend cooperates with the native Capacitor wrapper.
> Wrapper repo: `<path-to>/native-wrapper` (separate repository)
> Wrapper docs: `ARCHITECTURE.md` + `README.md` in the wrapper repo.

---

## Session / Auth

This app uses **Better Auth** with the **bearer plugin** — sessions are transported via `Authorization: Bearer <token>` header, not cookies. This is the correct approach for Capacitor WebViews where cookie handling is unreliable across Android/iOS.

- Token stored in `localStorage` on the frontend
- Custom HTTP interceptor attaches the `Authorization` header to all API requests (same as before auth migration)
- `authClient` imported from `better-auth/react` — used for `signOut()` and social sign-in
- `useCurrentUser()` (AuthContext) handles session state — TQ query key `queryKeys.account.current`
- Bearer token flow works transparently in WebView once a session exists — but **establishing** the session from a magic-link/OAuth tap on a phone requires native deep linking (see below)

### Deep-link login (magic-link + OAuth)

A magic-link/OAuth tap in an email on a phone must log the user into the **native app**, not the system
browser. The native shell catches the inbound Universal/App Link (or `nailfolio://` OAuth-return) and lands the
WebView on `https://<frontend>/app?authCode=…`, where the existing `AuthContext` variant-C exchange runs
unchanged. The shell never calls `/exchange-code` and never handles the token.

This required cross-repo changes (wrapper + `web-1` token bridge / magic-link adapter + `main` `.well-known/`
association files + gated OAuth UI). **Cutover LIVE since 2026-07-08**: `NATIVE_DEEPLINK_ENABLED=true` (web-1,
runtime kill-switch for the native return) and `NEXT_PUBLIC_OAUTH_ENABLED=true` (main, build-time — renders the
social buttons; Google live, Apple stays gated in `ENABLED_SOCIAL_PROVIDERS` until creds exist). Warm-start deep
links are received by `main/src/application/auth/native-deeplink-listener.ts` (`appUrlOpen`, wired into
AppLifecycle) — the wrapper listener dies once the WebView navigates to the app.

**SSOT + cutover runbook:** `native-wrapper/DEEPLINK_LOGIN.md`. Flag semantics + ADR-011 (no
`skipStateCookieCheck`): root `AGENTS.md` → "ZNANE DECYZJE ARCHITEKTONICZNE".

---

## How it works

The Capacitor wrapper is a thin native shell (Android/iOS) that loads this Next.js app in a WebView via `window.location.href`. The Capacitor bridge stays active thanks to `server.allowNavigation` in the wrapper config **plus a document-start bridge injection** (see below) — this means Next.js can call native device APIs (camera, haptics, clipboard, filesystem, network) through Capacitor plugins.

```
Native app launch
  → Wrapper splash screen (stays visible)
  → Health check (background)
  → window.location.href → Next.js loads in SAME WebView
  → RemoteBridgeInjector injects the Capacitor bridge at document-start
  → Next.js hydration completes
  → AppLifecycle calls SplashScreen.hide() + status bar theming
  → User sees ready app
```

---

## The remote-origin bridge (read this before adding a plugin)

Capacitor normally injects its bridge only into the pages it serves itself (`capacitor://localhost` / the shell origin). This app is **remote-loaded** from `https://nailfolio.app`, so out of the box the WebView on that origin had **no `window.Capacitor` at all** — every `isPluginAvailable()` gate returned false and every plugin call was dead, silently.

The wrapper closes that gap with `RemoteBridgeInjector` (`native-wrapper/android/app/src/main/java/com/nailfolio/app/RemoteBridgeInjector.java`). It registers a **document-start script** for every remote origin in `allowNavigation`, containing the same bridge/plugin JS that Capacitor injects locally. Verified live in the APK on `https://nailfolio.app` (2026-09-09).

**HARD RULE — adding a plugin takes THREE steps, not one:**

1. `npm install @capacitor/<plugin>` in the **wrapper** repo (+ `npx cap sync android`).
2. Add its **plugin id** to `EXPOSED_PLUGIN_IDS` in `RemoteBridgeInjector.java`. The id is the native `@CapacitorPlugin(name = "...")` value (`Clipboard`, `Filesystem`, `StatusBar`, `ScreenBrightness`, …), not the npm package name.
3. Address it from `main/` with `registerPlugin<T>('<Id>')` — **do NOT add the plugin to `main/package.json`**. The JS package would only duplicate a bridge proxy that already exists; the plugin implementation lives in the shell.

**Skip step 2 and the plugin works on the shell origin and is invisible on `nailfolio.app`** — no error, no log, just `isPluginAvailable() === false` and a silent fallback to the web path. That failure mode is indistinguishable from "the user is on the web", which is exactly why it went unnoticed.

Every helper in `application/platform/` follows the same shape, and it is the shape to copy:

- a locally declared minimal TS interface for the plugin (no npm types to import),
- `const { Capacitor, registerPlugin } = await import('@capacitor/core')` — **dynamic** import inside `try/catch`,
- gate on `Capacitor.isNativePlatform()` **and** `Capacitor.isPluginAvailable('<Id>')`,
- never throw: degrade silently to the web path. A native capability is progressive enhancement, never a condition for a screen to work.

There is **no barrel/index** in `application/platform/` — consumers deep-import the module path.

---

## MUST DO — rules that keep the wrapper working

### 1. SplashScreen.hide() after hydration

The wrapper holds the native splash screen (`launchAutoHide: false`) until Next.js signals readiness. Without this call, users are stuck on splash forever.

**Location:** `main/src/application/lifecycle/AppLifecycle.tsx` — dynamic import, guarded by `Capacitor.isNativePlatform()`.

### 2. viewport-fit=cover

Required for `env(safe-area-inset-*)` CSS values to work on iOS. Without it, insets are always 0 and content renders behind the notch/status bar.

**Location:** `main/src/pages/_app.tsx` — `<meta name='viewport'>` tag.

### 3. safe-area-inset CSS

Use `env(safe-area-inset-top)` for headers and `env(safe-area-inset-bottom)` for bottom navigation. Already done for `BottomTabBar` and `Toast`. Apply to any new fixed-position UI.

### 4. Android back button handler

Without `@capacitor/app` listener, Android hardware back button exits the app entirely. The handler in `AppLifecycle.tsx` routes the press through `useNavigationStore.getState().triggerBack` (registered by `NavigationTransitionController` — the NVT transition FSM), so a hardware press animates identically to the AppBar back button; when there is no history it calls `App.minimizeApp()`. Never call raw `history.back()` for in-app back UI — use `useNativeRouter().back()` (components) or `triggerBack` (module-level), otherwise the press bypasses the transition FSM.

### 5. refetchOnWindowFocus: false

Capacitor WebView fires `focus` events spuriously on: app resume from background, keyboard open/close, notification drawer, permission dialogs. Without this, TanStack Query would burst-refetch all queries on every app resume.

**Location:** `main/src/application/http/queryClient.config.ts` — already set.

---

## MUST NOT DO — things that break the wrapper

### 1. No `window.open()` or `target="_blank"` links

Opens the system browser, losing session and WebView context. All navigation must stay within the WebView using `next/router` or `next/link`.

**Use:** `openExternalUrl()` from `application/platform/browser.ts` — opens in-app browser on native, new tab on web.

### 2. No `window.location.href` to external domains

Navigates the WebView away from `allowNavigation` domains, breaking the Capacitor bridge. Internal redirects (e.g., to login page) are OK but prefer `router.push()`.

### 3. No Service Workers

Service workers in a Capacitor WebView intercept network requests meant for native plugins and cause caching conflicts. Do not register service workers.

### 4. Never trust `?platform=` for security

The `?platform=android|ios` query param is set client-side by the wrapper and can be trivially spoofed from a browser. Use it only for UI/UX decisions (show/hide app store banners, platform-specific layouts). Never use it for authentication or authorization.

---

## Platform detection

Two complementary approaches, use the right one for the job:

| Method                         | Use for                                                  | Location                                     |
| ------------------------------ | -------------------------------------------------------- | -------------------------------------------- |
| `Capacitor.isNativePlatform()` | Gating Capacitor plugin calls (haptics, splash, camera)  | Dynamic import in lifecycle code             |
| `detectPlatform()`             | UI/UX decisions (show/hide features, layouts, analytics) | `application/platform/platform.detection.ts` |

`detectPlatform()` uses a 4-step fallback: sessionStorage → URL param → `window.__NATIVE_APP__` bridge → UA sniffing.

---

## Installed Capacitor plugins

The native implementation always lives in the **wrapper**. `main/` ships the JS package only where it imports the plugin module directly (the older helpers); newer helpers use `registerPlugin` and need nothing in `main/package.json`. SSOT for versions = the two `package.json` files, not this table.

| Plugin id (bridge)                | npm package                             | In `main/` deps | Purpose                            | Used in                        |
| --------------------------------- | --------------------------------------- | --------------- | ---------------------------------- | ------------------------------ |
| —                                 | `@capacitor/core`                       | yes             | Bridge runtime                     | everywhere (isNativePlatform)  |
| `Network`                         | `@capacitor/network`                    | yes             | Online/offline detection           | `capacitor-online-manager.ts`  |
| `SplashScreen`                    | `@capacitor/splash-screen`              | yes             | Hide splash after hydration        | `AppLifecycle.tsx`             |
| `App`                             | `@capacitor/app`                        | yes             | Back button, app state, deep links | `AppLifecycle.tsx`, `platform/app-state.ts`, `auth/native-deeplink-listener.ts` |
| `Haptics`                         | `@capacitor/haptics`                    | yes             | Vibration on interactions          | `platform/haptics.ts`          |
| `Share`                           | `@capacitor/share`                      | yes             | Native share sheet                 | `platform/share.ts`            |
| `Keyboard`                        | `@capacitor/keyboard`                   | yes             | iOS keyboard resize behavior       | `AppLifecycle.tsx`             |
| `Browser`                         | `@capacitor/browser`                    | yes             | In-app browser for external links  | `platform/browser.ts`          |
| `Clipboard`                       | `@capacitor/clipboard`                  | **no**          | Copy to clipboard on native        | `platform/clipboard.ts`        |
| `Filesystem`                      | `@capacitor/filesystem`                 | **no**          | Write downloaded files to DOCUMENTS | `platform/download.ts`        |
| `StatusBar`                       | `@capacitor/status-bar`                 | **no**          | Status bar style + background      | `platform/status-bar.ts`       |
| `ScreenBrightness`                | `@capacitor-community/screen-brightness` | **no**         | Max brightness while a QR is shown | `platform/screen-brightness.ts` |

`CapacitorCookies`, `CapacitorHttp`, `WebView` and `SystemBars` are core runtime plugins — exposed through `EXPOSED_PLUGIN_IDS` for the bridge, not called from `main/`.

### Not yet installed (add when implementing)

| Plugin                          | Purpose                       | When                                        |
| ------------------------------- | ----------------------------- | ------------------------------------------- |
| `@capacitor/camera`             | Direct camera access          | When adding native camera to gallery upload |
| `@capacitor-firebase/messaging` | Push notifications (APNs→FCM) | Before App Store submission                 |

---

## Platform helpers (`application/platform/`)

| Module                     | Exports                                                | Native path                                     | Web / fallback path                              |
| -------------------------- | ------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------ |
| `platform.detection.ts`    | `detectPlatform()`                                      | sessionStorage → URL param → bridge flag → UA   | same (returns `isNativeApp: false`)              |
| `haptics.ts`               | `hapticImpact()`, `hapticNotification()`                | `Haptics.impact` / `.notification`              | no-op                                            |
| `haptic-press-listener.ts` | `initHapticPressListener()`                             | one delegated `pointerdown` listener for `.haptic-press` | registers nothing at all (zero per-click cost) |
| `app-state.ts`             | `onAppStateChange(listener)`                            | `App.addListener('appStateChange')`             | no-op unsubscribe                                |
| `share.ts`                 | `shareContent()` → `'native' \| 'web' \| 'clipboard' \| false` | native share sheet                       | `navigator.share`, then `copyText()`             |
| `browser.ts`               | `openExternalUrl()`                                     | in-app browser                                  | new tab                                          |
| `clipboard.ts`             | `copyText()` → `boolean`                                | `Clipboard.write`                               | `navigator.clipboard.writeText`                  |
| `download.ts`              | `downloadPngDataUrl()` → `'native' \| 'web' \| false`   | `Filesystem.writeFile` into DOCUMENTS           | blob objectURL + `<a download>`                  |
| `screen-brightness.ts`     | `requestMaxBrightness()` → lease with `release()`       | wake lock + `ScreenBrightness.setBrightness(1)` | wake lock only (`navigator.wakeLock`)            |
| `status-bar.ts`            | `initStatusBarTheming()` → unsubscribe                  | `StatusBar.setStyle` (+ `.setBackgroundColor`, **a measured no-op on Android 15+**), re-applied by a `MutationObserver` on `data-mode` | no-op |

Two things worth knowing before touching these:

- **`<a download>` on a blob URL is a silent no-op in the Android WebView.** Measured 2026-09-09: the click dispatches, nothing throws, no file is ever written. Anything that offers a file to the user must go through `download.ts`, otherwise the button reports success and does nothing. Full DECISION in the module.
- **`status-bar.ts` reads `data-mode` off `<html>` directly.** `application/` must not import from `UI/`, so this DOM read is the documented escape hatch (same one as `AppSnackbars.controller.tsx`). The colour comes from the live `--color-bg-main` token, never a hardcoded hex — the palette is the SSOT. Style polarity is inverted versus intuition: `Style.Dark = "DARK"` means **light text for dark backgrounds**, so `data-mode='dark'` → `'DARK'`.

`useExportUserData.ts` deliberately keeps its own two-tier clipboard/`execCommand` path (see its DECISION comments) and is not routed through `clipboard.ts`.

---

## Architecture: remote-load

The wrapper is a thin native shell that loads the Next.js app from a remote URL via `window.location.href`. This is the **deliberate, production architecture**.

**Why remote-load works well for a solo dev:**

- Push to server = instant update for all mobile users (no App Store review)
- Zero build pipeline complexity — no static export, no bundle versioning
- Next.js can use all its features (SSR, i18n, middleware, API rewrites)
- The wrapper shell handles offline/error UX: i18n (PL/EN/DE), auto-retry, dark mode, error type differentiation

**Trade-off:** Cold start without internet shows an error screen instead of working offline. Acceptable for a SaaS that requires internet to function.

**Decision (2026-05-16):** Capgo Live Update (bundled + OTA) cancelled. Static export was abandoned for i18n + SSR features. Remote-load is the final architecture.

### Offline cold start behavior

When the app opens without internet (or server is down), the native wrapper handles UX gracefully:

```
App launch → Splash stays visible → Health check (background)
  → FAIL: No internet / Server down / Timeout
  → Splash hides → ErrorScreen (branded, i18n PL/EN/DE, dark mode)
  → Auto-retry every 10s + `online` event listener
  → Connection restored → automatic navigation to Next.js
```

The ErrorScreen differentiates 3 error types with distinct icons and messages. Retry is both manual (button) and automatic. Android back button minimizes the app (not exit). Safe-area insets respected for iOS notch.

Implementation: `native-wrapper/src/components/ErrorScreen.tsx` + `src/lib/navigation.ts` (health check + retry logic).

---

## Store readiness — blockers

> Cross-reference: `native-wrapper/ARCHITECTURE.md` TODO section
> **iOS zdjęty z launchu (SPE 2026-06-17, DOMAIN_SSOT §18):** native app = Android-only; iPhone = mobile web.
> Wiersze Apple/App Store poniżej = deferred do decyzji o iOS, NIE launch-blockery.

### Before store submission

| Item                                                 | Status      | Notes                                                                          |
| ---------------------------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| Push notifications (`@capacitor-firebase/messaging`) | Not started | Required for Apple 4.2 justification + user engagement (iOS deferred)          |
| Privacy policy URL                                   | ✅ Live     | `/privacy` (route `ROUTES_FRONT.PRIVACY`, strona publiczna na nailfolio.app)   |
| Store metadata                                       | In progress | Google Play Data Safety; Apple App Privacy labels deferred (iOS) |

### Before production (HIGH priority)

| Item                           | Status      | Notes                                                                 |
| ------------------------------ | ----------- | --------------------------------------------------------------------- |
| Branded splash screen          | Not started | Replace Capacitor default with Nailfolio logo (SVG/PNG multi-density) |
| App icons                      | Not started | Verify not using Capacitor defaults                                   |
| iOS SplashScreen.hide() timing | Not tested  | Needs real iOS device verification                                    |

---

## Version compatibility

**Critical:** The wrapper and main/ must use compatible Capacitor versions. The bridge protocol must match between the native shell (wrapper) and JS plugins (main/).

| Component                 | Current version |
| ------------------------- | --------------- |
| Wrapper `@capacitor/core` | ^8.3.4          |
| Main `@capacitor/core`    | ^8.3.4          |

In sync (verified 2026-07-17). Keep in sync on future upgrades — SSOT: both `package.json` files, not this table.

---

## Key files

| File                                                | Purpose                                                 |
| --------------------------------------------------- | ------------------------------------------------------- |
| `application/lifecycle/AppLifecycle.tsx`            | Splash hide, back button, keyboard, online manager, status bar init |
| `application/http/capacitor-online-manager.ts`      | Network ↔ TanStack Query bridge                         |
| `application/http/queryClient.config.ts`            | refetchOnWindowFocus: false                             |
| `application/auth/native-deeplink-listener.ts`      | Warm-start login deep links (`appUrlOpen`)              |
| `application/platform/platform.detection.ts`        | Platform detection (native vs web)                      |
| `application/platform/haptics.ts`                   | Haptic feedback (`hapticImpact`, `hapticNotification`)  |
| `application/platform/haptic-press-listener.ts`     | Global `.haptic-press` delegation (native only)         |
| `application/platform/app-state.ts`                 | Foreground/background listener (resume hooks)           |
| `application/platform/share.ts`                     | Native share sheet with web fallback                    |
| `application/platform/browser.ts`                   | External URL in in-app browser                          |
| `application/platform/clipboard.ts`                 | Copy to clipboard (native bridge, web fallback)         |
| `application/platform/download.ts`                  | Save a PNG data-URL (Filesystem on native)              |
| `application/platform/screen-brightness.ts`         | Wake lock + max brightness while showing a QR code      |
| `application/platform/status-bar.ts`                | Status bar style/background following the live palette  |
| `native-wrapper/.../RemoteBridgeInjector.java`      | Document-start bridge for the remote origin + `EXPOSED_PLUGIN_IDS` |
| `.shared-kernel/domain/platform/platform.config.ts` | Platform types and constants                            |
| `pages/_app.tsx`                                    | viewport meta: viewport-fit=cover, interactive-widget   |
| `pages/_document.tsx`                               | zero-flash script, theme-color                          |
