# Android integration

The Android application is a separately maintained Capacitor shell that loads the
web application from a remote origin. This repository contains the web side of the
integration; native implementations and APK builds are outside the snapshot.

## Startup and bridge

The shell initializes the remote-origin bridge. Web lifecycle code waits for
hydration and signals that the splash screen can close. Plugin helpers check native
capability and provide a browser fallback or no-op where appropriate.

A bridge object being present does not establish that plugins are registered or
that a call can complete. The native smoke suite checks actual round trips. The
remote origin must also avoid the Capacitor HTTP patch, which can alter browser
request behavior.

## Authentication and deep links

Native social sign-in opens an external browser so the provider callback uses the
same cookie context as sign-in initiation. The return deep link carries a one-time
code. The web application exchanges it for a bearer token; the shell does not need
the session token in its URL.

Warm-start links are handled by `application/auth/native-deeplink-listener.ts`.
Platform hints affect presentation and routing, not authorization. Runtime and
build-time switches determine which native and social-login paths are available.

## Platform responsibilities

| Concern                                       | Web integration                                         |
| --------------------------------------------- | ------------------------------------------------------- |
| Splash, keyboard, app state and hardware back | Lifecycle helpers                                       |
| Safe areas                                    | Viewport configuration and `env(safe-area-inset-*)`     |
| Network state                                 | TanStack Query online-manager adapter                   |
| Haptics                                       | Platform helper and configured confirmed-outcome events |
| Share, clipboard and downloads                | Platform adapters with browser fallbacks                |
| External links                                | `openExternalUrl()`                                     |
| Notifications                                 | Native push in the shell, web push outside it           |

Avoid navigating the WebView to an unrelated origin. Use the app router for
internal navigation and the external-browser helper for outside links. File
sharing and downloads use the platform adapter because browser download behavior
is not equivalent inside Android WebView.

## Haptics and notifications

Configured response events drive outcome haptics through the event pipeline.
Selected camera, payment and upload outcomes use documented direct calls.
Routine navigation and taps do not automatically trigger a vibration.

Native push needs provider configuration in the shell and a device opt-in.
Registering a web-side handler alone does not establish push readiness. The native
and web implementations are coordinated by the push controller.

## Reading guide

Paths below are relative to `main/src/`:

- `application/lifecycle/AppLifecycle.tsx`
- `application/platform/haptics.ts`, `share.ts`, `browser.ts` and `download.ts`
- `application/auth/native-deeplink-listener.ts`
- `domain/notifications/push/push.controller.ts`

The Android shell and native test tooling are omitted from this export.
