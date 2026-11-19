# Static image assets

**English** | [Polski](README.pl.md)

This directory defines typed references to static interface and landing-page
images. The registry gives components a consistent way to select an image,
including its locale variants and responsive sources.

## Asset workflow

Source artwork and the private asset library are maintained separately. Runtime
files live under `main/public/`; registry definitions reference those public paths.
User-uploaded gallery photos are handled by the image service rather than this
static registry.

Use `LP_ASSETS` and the existing image helpers instead of repeating path literals
in feature components. Inspect adjacent call sites for the expected asset shape
and locale fallback. Keep dimensions and responsive variants with the definition.

## Adding or replacing an asset

1. Prepare the runtime image and any required locale or size variants.
2. Add or update its registry entry.
3. Use the existing rendering helper in the feature.
5. Inspect the rendered result at the intended width and theme.

Registry validation checks file references. It does not establish that the crop,
subject or text is appropriate for the page.

## Related documentation

- [UI architecture](../UI_ARCHITECTURE.md)
- [Asset command definitions](../../../../package.json)
