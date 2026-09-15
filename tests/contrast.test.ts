import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { contrastRatio, cssVariables, relativeLuminance } from '../lib/contrast';

describe('contrast maths', () => {
  it('black on white is 21:1', () => expect(contrastRatio('#000', '#ffffff')).toBeCloseTo(21, 5));
  it('is symmetric', () => expect(contrastRatio('#0550ae', '#fff')).toBeCloseTo(contrastRatio('#fff', '#0550ae'), 10));
  it('luminance of mid grey', () => expect(relativeLuminance('#777777')).toBeCloseTo(0.1845, 3));
  it('reads variables from a block', () => expect(cssVariables('.x {\n  --a: #fff;\n  --b: #000;\n}', '.x')).toEqual({ '--a': '#fff', '--b': '#000' }));
});

// Read from disk: Vitest turns CSS imports (even `?raw`) into empty strings.
const css = readFileSync(new URL('../lib/viewer.css', import.meta.url), 'utf8');

// The themes are held to WCAG 2.x AA (4.5:1) for every text colour on every
// background it can appear on. Change a colour in lib/viewer.css and this test
// tells you whether the theme still passes.
const FOREGROUNDS = ['--jvp-text', '--jvp-muted', '--jvp-key', '--jvp-string', '--jvp-number', '--jvp-boolean', '--jvp-null', '--jvp-bracket', '--jvp-link', '--jvp-error'];
const BACKGROUNDS = ['--jvp-bg', '--jvp-bg-alt', '--jvp-hover', '--jvp-selected-row', '--jvp-current-row', '--jvp-search-match'];

for (const theme of ['.jvp-light', '.jvp-dark']) {
  describe(`${theme} theme meets WCAG AA`, () => {
    const v = cssVariables(css, theme);
    for (const fg of FOREGROUNDS) {
      it(`${fg} on every background`, () => {
        for (const bg of BACKGROUNDS) {
          expect(v[fg], fg).toBeDefined();
          expect(v[bg], bg).toBeDefined();
          expect({ pair: `${fg} on ${bg}`, ratio: +contrastRatio(v[fg]!, v[bg]!).toFixed(2) }).toMatchObject({ ratio: expect.toSatisfy((r: number) => r >= 4.5) });
        }
      });
    }
    it('button text on the accent colour', () => expect(contrastRatio('#ffffff', v['--jvp-accent']!)).toBeGreaterThanOrEqual(4.5));
    it('error text on the error background', () => expect(contrastRatio(v['--jvp-text']!, v['--jvp-error-bg']!)).toBeGreaterThanOrEqual(4.5));
  });
}
