# Accessibility checks

The repository combines static JSX checks, browser accessibility scans and rendered
contrast probes. Each covers a different part of the interface; their results apply
to the routes and states actually checked.

## Static checks

`eslint-plugin-jsx-a11y` is configured in `main/eslint.config.mjs`. It checks JSX
patterns such as labels, roles and interactive semantics. Scoped exceptions remain
with the code and require review in context.

## Browser scans

The axe runner checks public pages in light and dark modes and can include
signed-in routes when given a bearer token:

```bash
node tests/a11y/axe-baseline.mjs
AXE_APP_TOKEN=<bearer> node tests/a11y/axe-baseline.mjs
```

Use an appropriate development account. The script is separate from local unit
checks. Its selected WCAG tags do not represent a complete accessibility evaluation.

## Rendered contrast and focus

`npm run qa:contrast` uses the browser probe to compare rendered text and focus
rings with their backgrounds. This addresses cases where component colors depend
on inherited or remapped tokens.

Keyboard operation, focus movement, screen-reader behavior and dynamic states still
need targeted checks. Historical measurements are not evidence for a later build.
Inspect the current motion styles and platform settings when evaluating reduced
motion; the tools here do not establish that behavior.
