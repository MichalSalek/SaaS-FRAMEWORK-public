# UI architecture

The UI is a React application using Next.js Pages Router. Features combine typed
API declarations, TanStack Query hooks and components. Shared services and business
contracts are kept outside rendering code.

## Directory guide

| Path under `src/` | Responsibility                                            |
| ----------------- | --------------------------------------------------------- |
| `pages/`          | Routes, server/static data and page metadata              |
| `UI/features/`    | Feature screens, hooks and local components               |
| `UI/components/`  | Shared component library                                  |
| `UI/primitives/`  | Base interactive widgets                                  |
| `UI/layouts/`     | Public, app and admin frames                              |
| `UI/styles/`      | Global styles and design tokens                           |
| `application/`    | Transport, session state, navigation and platform helpers |
| `domain/`         | Endpoint declarations grouped by area                     |
| `locales/`        | Interface translations                                    |

## Data flow

A domain declaration uses `defineEndpoint`, `defineQuery` or `definePathEndpoint`
from `application/http/io.ts`. The declaration returns a typed Promise function;
a feature hook uses it as a query or mutation function. Hooks define query gating,
cache invalidation and optimistic rollback.

The response event pipeline handles shared feedback. Local feedback ownership is
explicit so that one successful mutation does not produce competing confirmations.
Network access has documented exceptions for uploads and selected authentication
flows. See the comments in `io.ts` before adding another transport path.

## Components and imports

Component file and export names declare their layer: atom, molecule, organism or
composition. The [component layer guide](components/ATOMIC_LAYERS.md) defines these
roles and the lint boundaries. Feature-specific pieces live with their screen;
reusable components belong in `components/` when there is a shared use.

The frontend domain directory describes API calls, not backend business operations.
The application layer should not depend on UI rendering. Documented exceptions and
import rules are defined in `main/eslint.config.mjs`.

## Layout ownership

A page file loads messages or server data, supplies metadata and mounts the feature
composition. The feature mounts its layout. An inner content component can return
loading, empty or error states while the outer layout remains present.

`PublicLayout` supports public pages. `AppLayout` supplies the phone-oriented app
shell and client guards. `AdminLayout` and `AdminPageLayout` supply administration
navigation. Desktop access for the product app is resolved by
`application/policies/desktop-access.policy.ts`; it depends on environment and user
context, rather than viewport alone.

## Styling and theme

CSS Modules use shared color, spacing, type, shape and motion tokens. The HTML
`data-theme` and `data-mode` attributes select palette and light/dark mode. The
initial theme script sets those attributes before hydration using stored preferences.
Font roles and palette values are defined in the stylesheet configuration.

The shared button primitive owns forward-navigation arrows through its `direction`
prop. Actions that save, delete or open a dialog use an appropriate action icon or
no icon. This keeps icon placement with the primitive rather than each caller.

## Navigation and providers

`pages/_app.tsx` composes QueryClient, authentication, theme, translations and app
lifecycle providers. The navigation controller owns router event subscriptions and
updates `application/stores/navigation.store.ts`. Content shells apply transitions
while navigation chrome remains in place.

Programmatic navigation uses the existing router helper and transition policy.
Authentication redirects and identity changes can select an instant transition.
The API remains responsible for authorization even when a client guard redirects.

## Native behavior and verification

Capacitor integration is behind platform and lifecycle adapters. A browser viewport
test does not check plugin registration, keyboard handling or native deep links;
those require the [native integration guide](NATIVE_INTEGRATION_GUIDE.md) and an APK.

Static audits check naming, routes, tokens and selected structural patterns.
Browser probes and direct inspection check geometry, focus, theme and visible state.
The [frontend test guide](../../../tests/FRONTEND_TESTING.md) explains unit and
browser test boundaries.
