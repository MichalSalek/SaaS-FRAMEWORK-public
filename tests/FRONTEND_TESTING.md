# Frontend testing

Vitest checks client policies, hooks and selected rendering behavior. React Testing
Library runs in jsdom, with MSW handling network requests. Browser journeys and
visual inspection cover behavior outside this environment.

## What is tested

| Area                                  | Approach                                        |
| ------------------------------------- | ----------------------------------------------- |
| Pure policies and formatters          | Direct input/output assertions                  |
| Query gating and mutation behavior    | Hooks with a real test QueryClient and MSW      |
| Optimistic updates and rollback       | Cache and result assertions around the mutation |
| Cross-feature invalidation            | Query-key and cache behavior                    |
| Selected provider and render behavior | `renderWithProviders`                           |
| Navigation and sessions in a browser  | Playwright                                      |

## Isolation and async behavior

Create a fresh QueryClient per test using `makeTestQueryClient`,
`renderWithProviders` or `createQueryWrapper`. Reusing the production singleton
would share cache state between scenarios.

MSW handlers are configured per test; unhandled requests are errors. This helps
reveal requests that bypass an intended `enabled` condition. Use `waitFor`,
`findBy*` and `act` for asynchronous behavior rather than arbitrary delays.

Prefer semantic selectors. Check event or feedback ownership at the relevant
service boundary instead of asserting incidental snackbar DOM structure.

## Infrastructure

- `main/vitest.config.ts`: environment, aliases and test selection.
- `main/vitest.setup.ts`: MSW lifecycle, cleanup and browser API substitutes.
- `main/src/test-utils/renderWithProviders.tsx`: test providers and query helpers.
- `main/src/test-utils/msw/`: shared network setup.

These paths are relative to the repository root. Tests normally sit beside the
implementation they exercise.

## Limits

The sample omits parts of the runtime and tooling. jsdom does not measure layout or reproduce Android plugin behavior. [Playwright](e2e/README.md) covers selected browser journeys; it does not prove that every behavior is covered.
