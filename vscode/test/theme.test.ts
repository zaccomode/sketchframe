import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { jsonColorsFromRules, parseTheme } from '../src/themeRules.ts';
import type { TokenRule } from '../src/themeRules.ts';

test('picks the most specific rule for each JSON token', () => {
  const rules: TokenRule[] = [
    { scope: 'string', settings: { foreground: '#111111' } },
    { scope: ['support.type.property-name'], settings: { foreground: '#222222' } },
    { scope: 'constant.numeric, constant.language', settings: { foreground: '#333333' } },
    { scope: 'constant.language.json', settings: { foreground: '#444444' } },
    { scope: 'source.json string', settings: { foreground: '#ff0000' } },
  ];
  assert.deepEqual(jsonColorsFromRules(rules), {
    key: '#222222',
    string: '#111111',
    number: '#333333',
    constant: '#444444',
  });
});

test('reads theme files with comments and trailing commas', () => {
  const theme = parseTheme(`{
    // A comment, and a URL that naive comment stripping would break
    "$schema": "vscode://schemas/color-theme",
    "include": "./base.json",
    "tokenColors": [{ "scope": "string", "settings": { "foreground": "#abcdef" } },],
  }`);
  assert.equal(theme.include, './base.json');
  assert.deepEqual(jsonColorsFromRules(theme.tokenColors ?? []).string, '#abcdef');
});

// VS Code's own themes, when it's installed here. Dark Modern includes Dark+,
// which gives JSON keys their light blue.
const themes = '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/theme-defaults/themes';
test('resolves Dark Modern through its include', { skip: !existsSync(themes) && 'VS Code not installed' }, () => {
  const load = (file: string): TokenRule[] => {
    const theme = parseTheme(readFileSync(file, 'utf8'));
    const base = theme.include ? load(join(dirname(file), theme.include)) : [];
    return [...base, ...(theme.tokenColors ?? [])];
  };
  const colors = jsonColorsFromRules(load(join(themes, 'dark_modern.json')));
  assert.equal(colors.key?.toUpperCase(), '#9CDCFE');
  assert.equal(colors.string?.toUpperCase(), '#CE9178');
  assert.equal(colors.number?.toUpperCase(), '#B5CEA8');
  assert.equal(colors.constant?.toUpperCase(), '#569CD6');
});
