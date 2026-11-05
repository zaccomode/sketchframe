// Picks JSON token colours out of a VS Code theme's token rules. Kept free of
// the `vscode` module so the tests can run it against real theme files.

import { parse } from 'jsonc-parser';
import type { JSONColors } from './protocol.ts';

export type TokenRule = { scope?: string | string[]; settings?: { foreground?: string } };

export type ThemeFile = { include?: string; tokenColors?: TokenRule[] };

/** The scopes VS Code's JSON grammar gives each kind of token, innermost first. */
const scopes: Record<keyof JSONColors, string[]> = {
  key: ['support.type.property-name.json', 'support.type.property-name', 'string.json'],
  string: ['string.quoted.double.json', 'string.quoted.double', 'string'],
  number: ['constant.numeric.json', 'constant.numeric'],
  constant: ['constant.language.json', 'constant.language'],
};

/** Theme files are JSON with comments and trailing commas. */
export function parseTheme(text: string): ThemeFile {
  const theme = parse(text);
  return {
    include: typeof theme?.include === 'string' ? theme.include : undefined,
    // `tokenColors` can also name a .tmTheme file, which isn't worth
    // parsing: the webview falls back to its own colours.
    tokenColors: Array.isArray(theme?.tokenColors) ? theme.tokenColors : [],
  };
}

export function jsonColorsFromRules(rules: TokenRule[]): JSONColors {
  const colors: JSONColors = {};
  for (const kind of Object.keys(scopes) as (keyof JSONColors)[]) {
    colors[kind] = colorFor(scopes[kind], rules);
  }
  return colors;
}

/**
 * TextMate-style matching, simplified: a rule matches a scope it equals or
 * is a dot-separated prefix of, the longest match wins, and later rules win
 * ties. Descendant selectors (`a b`) are skipped.
 */
function colorFor(candidates: string[], rules: TokenRule[]): string | undefined {
  for (const scope of candidates) {
    let best: { length: number; color: string } | undefined;
    for (const rule of rules) {
      const color = rule.settings?.foreground;
      if (!color) continue;
      const selectors = Array.isArray(rule.scope) ? rule.scope : (rule.scope ?? '').split(',');
      for (const selector of selectors.map((s) => s.trim())) {
        if (!selector || selector.includes(' ')) continue;
        if (scope === selector || scope.startsWith(`${selector}.`)) {
          if (!best || selector.length >= best.length) best = { length: selector.length, color };
        }
      }
    }
    if (best) return best.color;
  }
  return undefined;
}
