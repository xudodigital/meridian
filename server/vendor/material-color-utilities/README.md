# material-color-utilities (vendored)

Part of `@material/material-color-utilities` **0.4.0** (npm), the Material Design 3 colour library by Google LLC,
from https://github.com/material-foundation/material-color-utilities (folder `typescript`). Licensed under the
Apache License 2.0: see `LICENSE` in this folder. Meridian's website builds use it through `server/theme.ts` to
make HCT tonal palettes and the light and dark schemes (SchemeTonalSpot, SchemeContent) from a site's source colour.

Only the modules that `theme.ts` needs are copied, as published in the npm package's compiled ESM (`.js`) with
their type declarations (`.d.ts`). Meridian does not use npm packages on the server, so the files live here.

## Changes made for Meridian

Every changed file says so in a line after its license header (`// Modified for Meridian …`).

- **All `.js` files:** the last line, `//# sourceMappingURL=<file>.js.map`, was removed (the source maps are not
  copied).
- **Relative import paths given the `.js` extension**, so Node resolves them as ES modules. In
  `dynamiccolor/color_spec_2025.js`, `scheme/scheme_content.js` and `scheme/scheme_tonal_spot.js`, and in the
  declarations `dynamiccolor/color_spec.d.ts`, `dynamiccolor/color_spec_2021.d.ts`, `dynamiccolor/color_spec_2025.d.ts`,
  `dynamiccolor/dynamic_color.d.ts`, `dynamiccolor/material_dynamic_colors.d.ts`, `scheme/scheme_content.d.ts` and
  `scheme/scheme_tonal_spot.d.ts`. For example `'../dynamiccolor/dynamic_scheme'` became
  `'../dynamiccolor/dynamic_scheme.js'`.

Nothing else was changed: no code, names or behaviour.

## Updating

Run `npm pack @material/material-color-utilities@<version>` in a scratch folder, copy the same modules from
`package/`, make the two changes above (and the notice lines), and update the version here and in the notices.
