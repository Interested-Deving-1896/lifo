import { describe, it, expect } from 'vitest';
import { extractTailwindConfig } from '../../src/commands/system/browser-metro.js';

/**
 * extractTailwindConfig finds the balanced `module.exports = {...}` block by
 * scanning characters and tracking quote state, then evals it and inlines
 * `theme.extend` into the Tailwind CDN config for the preview.
 *
 * The regression pinned here: the scanner tracked quotes but not comments, so
 * an apostrophe inside a comment ("the source's fonts") opened a phantom
 * string, quote parity flipped for the rest of the file, the closing brace was
 * never found, and the ENTIRE theme was silently dropped. Every CSS-variable
 * class (bg-background etc.) then emitted no CSS and the preview rendered as
 * an unthemed white page while the device rendered the real design.
 */

const FALLBACK = 'tailwind.config={darkMode:"class"}';

describe('extractTailwindConfig — comment handling', () => {
  // The exact shape that broke the APEX.AI project preview.
  it('survives an apostrophe in a line comment', () => {
    const config = `module.exports = {
  theme: {
    extend: {
      // mirroring the source's --font-display / --font-sans / --font-mono vars.
      colors: { background: 'rgb(var(--background) / <alpha-value>)' },
    },
  },
};`;
    const out = extractTailwindConfig(config);
    expect(out).not.toBe(FALLBACK);
    expect(out).toContain('--background');
  });

  it('survives quotes and braces inside a block comment', () => {
    const config = `module.exports = {
  /* it's got 'quotes' and a stray } brace and even a { */
  theme: { extend: { colors: { brand: '#ec305a' } } },
};`;
    expect(extractTailwindConfig(config)).toContain('#ec305a');
  });

  it('does not treat // inside a string as a comment', () => {
    const config = `module.exports = {
  theme: {
    extend: {
      backgroundImage: { hero: "url('https://cdn.example.com/a.png')" },
      colors: { brand: '#ec305a' },
    },
  },
};`;
    const out = extractTailwindConfig(config);
    expect(out).toContain('cdn.example.com');
    expect(out).toContain('#ec305a');
  });

  it('handles a comment on the same line as real config (trailing comment)', () => {
    const config = `module.exports = {
  theme: {
    extend: {
      colors: { brand: '#fff' }, // that's the brand white
    },
  },
};`;
    expect(extractTailwindConfig(config)).toContain('#fff');
  });
});

describe('extractTailwindConfig — existing behaviour kept', () => {
  it('extracts a comment-free config (the old happy path)', () => {
    const config = `module.exports = { darkMode: 'class', theme: { extend: { colors: { x: '#fff' } } } };`;
    expect(extractTailwindConfig(config)).toBe(
      'tailwind.config={darkMode:"class",theme:{extend:{"colors":{"x":"#fff"}}}};'
    );
  });

  it('handles the full template shape: require(), process.env, safelist regex, content globs', () => {
    const config = `/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: process.env.DARK_MODE ? process.env.DARK_MODE : 'class',
  content: ['./app/**/*.{html,js,jsx,ts,tsx,mdx}'],
  presets: [require('nativewind/preset')],
  important: 'html',
  safelist: [{ pattern: /(bg|text)-(background|foreground)/ }],
  theme: {
    extend: {
      colors: { background: 'rgb(var(--background) / <alpha-value>)' },
      fontFamily: { display: ['Anton_400Regular'] },
    },
  },
};`;
    const out = extractTailwindConfig(config);
    expect(out).toContain('--background');
    expect(out).toContain('Anton_400Regular');
  });

  it('supports export default', () => {
    const config = `export default { theme: { extend: { colors: { y: '#000' } } } };`;
    expect(extractTailwindConfig(config)).toContain('#000');
  });

  it('falls back safely when there is no theme.extend', () => {
    expect(extractTailwindConfig(`module.exports = { darkMode: 'class' };`)).toBe(FALLBACK);
  });

  it('falls back safely on garbage input', () => {
    expect(extractTailwindConfig('not a config at all')).toBe(FALLBACK);
    expect(extractTailwindConfig('module.exports = {')).toBe(FALLBACK);
  });
});

/**
 * Configs that compute their theme from top-level helpers. The old extractor
 * sliced out only the module.exports literal, so `...scaledFontSizes` and
 * `scaled('10px')` were undefined there, the eval threw, and the ENTIRE theme
 * (colors, fonts, radii) was silently dropped. Device builds run the real
 * config, so only the artboard lost its styling.
 */
describe('extractTailwindConfig — configs built from top-level helpers', () => {
  // Trimmed from LibreAte (project 6YuOloHrN3WIW8FhNVZrk); helpers verbatim.
  const LIBREATE = `const defaultTheme = require('tailwindcss/defaultTheme');

// App-wide text scale (see src/lib/textScale.ts for the why).
const { scale: TEXT_SCALE } = require('./text-scale.json');

/** Multiply a rem/px length by the text scale; unitless values pass through. */
const scaled = (value) =>
  String(value).replace(
    /^([\\d.]+)(rem|px)$/,
    (_, n, unit) => \`\${+(n * TEXT_SCALE).toFixed(4)}\${unit}\`,
  );

const scaledFontSizes = Object.fromEntries(
  Object.entries(defaultTheme.fontSize).map(([name, [size, opts]]) => [
    name,
    [scaled(size), { ...opts, lineHeight: scaled(opts.lineHeight) }],
  ]),
);
const scaledLineHeights = Object.fromEntries(
  Object.entries(defaultTheme.lineHeight).map(([name, value]) => [name, scaled(value)]),
);

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: process.env.DARK_MODE ? process.env.DARK_MODE : 'class',
  content: ['./app/**/*.{html,js,jsx,ts,tsx,mdx}'],
  presets: [require('nativewind/preset')],
  important: 'html',
  theme: {
    extend: {
      borderRadius: { DEFAULT: 'var(--radius)' },
      colors: { background: 'rgb(var(--background) / <alpha-value>)' },
      fontFamily: { 'body': ['Inter_400Regular'] },
      fontSize: {
        ...scaledFontSizes,
        '2xs': scaled('10px'),
        'field': scaled('1rem'),
      },
      lineHeight: scaledLineHeights,
    },
  },
};`;

  const parse = (out: string) =>
    JSON.parse(out.slice('tailwind.config={darkMode:"class",theme:{extend:'.length, -'}};'.length));

  it('keeps the whole theme and applies the scale from the required json', () => {
    const out = extractTailwindConfig(LIBREATE, (p) =>
      p === './text-scale.json' ? '{ "scale": 1.1 }' : undefined);
    expect(out).not.toBe(FALLBACK);
    const extend = parse(out);
    expect(extend.colors.background).toBe('rgb(var(--background) / <alpha-value>)');
    expect(extend.fontFamily.body).toEqual(['Inter_400Regular']);
    expect(extend.borderRadius.DEFAULT).toBe('var(--radius)');
    expect(extend.fontSize.base).toEqual(['1.1rem', { lineHeight: '1.65rem' }]);
    expect(extend.fontSize['5xl']).toEqual(['3.3rem', { lineHeight: '1' }]);
    expect(extend.fontSize['2xs']).toBe('11px');
    expect(extend.fontSize.field).toBe('1.1rem');
    expect(extend.lineHeight['6']).toBe('1.65rem');
    expect(extend.lineHeight.tight).toBe('1.25');
  });

  it('an unreadable local require falls back instead of emitting NaN sizes', () => {
    const out = extractTailwindConfig(LIBREATE, () => undefined);
    expect(out).not.toContain('NaN');
  });

  it('TypeScript configs still go through the slicer', () => {
    const config = `import type { Config } from 'tailwindcss';
export default {
  theme: { extend: { colors: { brand: '#ec305a' } } },
} satisfies Config;`;
    expect(extractTailwindConfig(config)).toContain('#ec305a');
  });
});
