# Component layers

File and export names identify a component's role. These labels support navigation
and import rules; they are not a measure of visual size or complexity.

## Layer definitions

| Layer         | Role                                                    | Shared-component dependencies                                 |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| `atom`        | A base component without other shared-component imports | None; hooks, icons and utilities are allowed                  |
| `molecule`    | A reusable block combining smaller components           | Atoms and molecules                                           |
| `organism`    | A section or substantial interactive block              | Atoms, molecules, organisms and the permitted section wrapper |
| `composition` | Layout or orchestration                                 | Components needed for that composition                        |

The import structure and explicit project conventions determine the layer. A
business-specific name does not by itself make a component an organism.

## Naming and placement

`Button.atom.tsx` exports `ButtonAtom`; its stylesheet remains `Button.module.css`.
A feature screen uses `<Name>Page.composition.tsx`, and extracted parts declare
their own layer. Hooks, models, configuration and tests use role-specific names
rather than a component-layer suffix.

Shared components live here. Feature-specific components stay in `UI/features/`.
Use direct-path imports. Existing barrel exceptions, such as the JSON-LD entry
point, are documented in code and do not establish a general barrel convention.

## Classification examples

`Section` is a layout composition and is explicitly allowed as a wrapper for
organisms. `SectionHeader` combines atoms and is a molecule. `ErrorBoundary`,
`JsonLd` and `PublicSeoHead` coordinate behavior rather than visible content.
`InfiniteScrollTrigger` coordinates pagination even though it can render an indicator.

Some historical role classifications are explicit conventions. Check the relevant
component and ESLint configuration before changing a suffix solely from its name.

## Checks and limits

`atomic-coverage.sh` checks file and export suffixes throughout `src/UI` and writes
a report. ESLint restricts dependency direction among shared components.
`ui-library-coverage.sh` checks registration in the component library.

The suffix check also covers feature components, while their cross-feature imports
follow separate rules. A valid suffix does not establish correct responsibility,
accessibility or visual quality; those require review and behavioral checks.
