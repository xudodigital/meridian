// A site's theme: the Material 3 colour roles generated from one source colour through HCT tonal palettes, in a light
// and a dark scheme, plus the font stacks of each pairing. The colour science is Google's own library, vendored as
// plain JavaScript (server/vendor/material-color-utilities, @material/material-color-utilities 0.4.0, Apache-2.0),
// because M3 colours must never be hand-picked or shifted in HSL. Fonts are system stacks only: a built site makes no
// request to another host.
import { Hct } from './vendor/material-color-utilities/hct/hct.js';
import { MaterialDynamicColors } from './vendor/material-color-utilities/dynamiccolor/material_dynamic_colors.js';
import type { DynamicScheme } from './vendor/material-color-utilities/dynamiccolor/dynamic_scheme.js';
import { SchemeTonalSpot } from './vendor/material-color-utilities/scheme/scheme_tonal_spot.js';
import { argbFromHex, hexFromArgb } from './vendor/material-color-utilities/utils/string_utils.js';

/** Role name (as in --md-sys-color-<role>) -> #rrggbb. */
export type Scheme = Record<string, string>;
export type FontPairing = 'editorial' | 'modern' | 'humanist';
export const FONT_PAIRINGS: readonly FontPairing[] = ['editorial', 'modern', 'humanist'];

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);

const mdc = new MaterialDynamicColors();
/* The 26 roles a page uses, and the few extra ones M3 defines for inverse surfaces and shadows. */
const ROLES: [string, (m: MaterialDynamicColors) => { getArgb(s: DynamicScheme): number }][] = [
  ['primary', m => m.primary()], ['on-primary', m => m.onPrimary()],
  ['primary-container', m => m.primaryContainer()], ['on-primary-container', m => m.onPrimaryContainer()],
  ['secondary', m => m.secondary()], ['on-secondary', m => m.onSecondary()],
  ['secondary-container', m => m.secondaryContainer()], ['on-secondary-container', m => m.onSecondaryContainer()],
  ['tertiary', m => m.tertiary()], ['on-tertiary', m => m.onTertiary()],
  ['tertiary-container', m => m.tertiaryContainer()], ['on-tertiary-container', m => m.onTertiaryContainer()],
  ['error', m => m.error()], ['on-error', m => m.onError()],
  ['error-container', m => m.errorContainer()], ['on-error-container', m => m.onErrorContainer()],
  ['surface', m => m.surface()], ['surface-dim', m => m.surfaceDim()], ['surface-bright', m => m.surfaceBright()],
  ['surface-container-lowest', m => m.surfaceContainerLowest()], ['surface-container-low', m => m.surfaceContainerLow()],
  ['surface-container', m => m.surfaceContainer()], ['surface-container-high', m => m.surfaceContainerHigh()],
  ['surface-container-highest', m => m.surfaceContainerHighest()],
  ['on-surface', m => m.onSurface()], ['on-surface-variant', m => m.onSurfaceVariant()],
  ['outline', m => m.outline()], ['outline-variant', m => m.outlineVariant()],
  ['inverse-surface', m => m.inverseSurface()], ['inverse-on-surface', m => m.inverseOnSurface()],
  ['inverse-primary', m => m.inversePrimary()], ['scrim', m => m.scrim()], ['shadow', m => m.shadow()],
];

/** The light and dark schemes of a source colour (M3 "tonal spot", the default dynamic scheme, standard contrast). */
export function schemes(sourceHex: string): { light: Scheme; dark: Scheme } {
  const hct = Hct.fromInt(argbFromHex(isHex(sourceHex) ? sourceHex : '#6750a4'));
  const of = (dark: boolean): Scheme => {
    const s = new SchemeTonalSpot(hct, dark, 0);
    return Object.fromEntries(ROLES.map(([name, role]) => [name, hexFromArgb(role(mdc).getArgb(s))]));
  };
  return { light: of(false), dark: of(true) };
}

/** CSS custom properties for a scheme: `--md-sys-color-primary: #…;` one per role. */
export const tokens = (s: Scheme, indent = '  '): string => Object.entries(s).map(([k, v]) => `${indent}--md-sys-color-${k}: ${v};`).join('\n');

/**
 * A pleasant source colour derived from any text (a domain), for a site whose identity has none: a hue from a hash,
 * with the chroma and tone M3 source colours usually have.
 */
export function seedColor(text: string): string {
  let h = 2166136261;
  for (const ch of text) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619) >>> 0; }
  return hexFromArgb(Hct.from(h % 360, 48, 45).toInt());
}

/** The colour as red, green, blue (0-255). */
export const rgbOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * System font stacks for each pairing: `brand` for display, headline and title-large, `plain` for everything else
 * (M3 type roles). The stacks reach a good face on macOS, iOS, Windows, Android and Linux without downloading one.
 */
export const FONTS: Record<FontPairing, { brand: string; plain: string }> = {
  editorial: {
    brand: `"Iowan Old Style", "Palatino Linotype", Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, "Noto Serif", serif`,
    plain: `system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif`,
  },
  modern: {
    brand: `"Avenir Next", Avenir, "Segoe UI Variable Display", "Segoe UI", Montserrat, Corbel, "URW Gothic", "Noto Sans", sans-serif`,
    plain: `system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif`,
  },
  humanist: {
    brand: `Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", "Noto Sans", source-sans-pro, sans-serif`,
    plain: `Seravek, "Gill Sans Nova", Ubuntu, Calibri, system-ui, "Segoe UI", Roboto, "Noto Sans", sans-serif`,
  },
};

/**
 * The M3 line-height multiplier for a language (BCP 47 primary subtag): scripts with tall marks need more room.
 * 1 for Latin, Cyrillic and Greek; 1.07 for Vietnamese, Thai, Arabic, the Indic scripts and CJK; 2 for Urdu (Nastaliq).
 */
export function langHeight(tag: string): number {
  const lang = tag.split('-')[0]!.toLowerCase();
  if (lang === 'ur') return 2;
  if (['my', 'te'].includes(lang)) return 1.3;
  if (['vi', 'th', 'ar', 'hi', 'bn', 'fa', 'ja', 'ko', 'zh', 'km', 'lo', 'ta', 'ne', 'mr', 'gu', 'pa', 'si'].includes(lang)) return 1.07;
  return 1;
}
