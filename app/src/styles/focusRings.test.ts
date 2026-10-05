import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* `all:unset` on a control also drops the outline that base.css gives every `:focus-visible` element, and the control's
   own rule wins (same or higher specificity, later in the proto layer). So every control styled with `all:unset` must
   restore a visible focus ring itself, or keyboard users see nothing (WCAG 2.4.7). This reads the stylesheets as text:
   jsdom does not resolve the cascade, and the point is the rule's presence, not its rendering. */

const srcDir = resolve(import.meta.dirname, '..');

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : cssFiles(p);
    return e.name.endsWith('.css') ? [p] : [];
  });
}

type Rule = { selectors: string[]; block: string };

/* Innermost rules only: `sel{decls}` with no nested braces. Rules inside @media show up as their own entries. */
function rules(css: string): Rule[] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  for (const m of noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (selector.startsWith('@')) continue;
    out.push({ selectors: selector.split(',').map(s => s.trim()).filter(Boolean), block: m[2] });
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* A ring the user can see: the block itself sets `outline` to something other than none/0 (not just outline-offset,
   which draws nothing when the outline stays unset), or draws the ring with box-shadow (the .dd dropdown trigger). */
function drawsRing(block: string): boolean {
  const decls = block.split(';').map(d => d.trim()).filter(Boolean);
  const outline = decls.find(d => /^outline\s*:/.test(d))?.replace(/^outline\s*:\s*/, '').trim();
  if (outline && !/^(none|0)(\s|$)/.test(outline)) return true;
  return decls.some(d => /^box-shadow\s*:\s*(?!none)/.test(d));
}

const files = cssFiles(srcDir);
const parsed = files.map(f => ({ file: relative(srcDir, f), rules: rules(readFileSync(f, 'utf8')) }));
const allRules = parsed.flatMap(p => p.rules);

const unsetSelectors = parsed.flatMap(p =>
  p.rules.filter(r => /\ball\s*:\s*unset\b/.test(r.block)).flatMap(r => r.selectors.map(selector => ({ file: p.file, selector }))),
);

/* The focus rule for `.pst` is `button.pst:focus-visible`; a compound prefix on the same element is fine, a different
   element (`.x .pst:focus-visible` is not matched here, since a space would precede) is not. */
function focusRulesFor(selector: string): Rule[] {
  const re = new RegExp(`^[^\\s>+~]*${escapeRe(selector)}:focus-visible$`);
  return allRules.filter(r => r.selectors.some(s => re.test(s)));
}

describe('focus rings on all:unset controls', () => {
  it('finds the controls styled with all:unset', () => {
    expect(files.length).toBeGreaterThan(5);
    const selectors = unsetSelectors.map(u => u.selector);
    expect(selectors).toEqual(expect.arrayContaining([
      '.ib', '.navgroup button', '.tabs button', '.tree button', '.rvlist button.art', '.stn', '.ddo',
      '.dd', '.linkbtn', '.me', '.nt', '.navsearch', '.mk', '.crow', '.pst',
    ]));
  });

  it.each(unsetSelectors.map(u => [u.selector, u.file] as const))('%s (%s) restores a visible :focus-visible ring', selector => {
    const focus = focusRulesFor(selector);
    expect(focus.length, `${selector} has no :focus-visible rule`).toBeGreaterThan(0);
    expect(focus.some(r => drawsRing(r.block)), `${selector}:focus-visible sets no outline (or box-shadow); outline-offset alone draws nothing`).toBe(true);
  });

  it('keeps the primary ring on active items whose fill is primary', () => {
    const active = (sel: string) => allRules.find(r => r.selectors.includes(sel))?.block ?? '';
    expect(active('.navgroup button[aria-current="page"]:focus-visible')).toMatch(/outline-color:\s*var\(--md-sys-color-on-primary\)/);
    expect(active('.tree button.on:focus-visible')).toMatch(/outline-color:\s*var\(--md-sys-color-on-primary\)/);
  });
});
