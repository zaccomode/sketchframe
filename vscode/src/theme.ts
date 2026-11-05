// Webviews get the theme's UI colours as CSS variables, but not its syntax
// colours. To highlight JSON the way a JSON editor does, read the active
// theme's own file and pick the colours its rules give JSON's scopes.

import * as vscode from 'vscode';
import type { JSONColors } from './protocol.ts';
import { jsonColorsFromRules, parseTheme } from './themeRules.ts';
import type { TokenRule } from './themeRules.ts';

export async function jsonTokenColors(): Promise<JSONColors> {
  try {
    return jsonColorsFromRules(await loadRules(activeThemeFile()));
  } catch {
    return {};
  }
}

/** The active theme's file, found among the extensions that contribute themes. */
function activeThemeFile(): vscode.Uri | undefined {
  const workbench = vscode.workspace.getConfiguration('workbench');
  let name = workbench.get<string>('colorTheme');
  if (vscode.workspace.getConfiguration('window').get<boolean>('autoDetectColorScheme')) {
    const kind = vscode.window.activeColorTheme.kind;
    const dark = kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
    name = workbench.get<string>(dark ? 'preferredDarkColorTheme' : 'preferredLightColorTheme') ?? name;
  }
  for (const extension of vscode.extensions.all) {
    const themes: { id?: string; label?: string; path?: string }[] = extension.packageJSON?.contributes?.themes ?? [];
    const theme = themes.find((theme) => theme.id === name || theme.label === name);
    if (theme?.path) return vscode.Uri.joinPath(extension.extensionUri, theme.path);
  }
  return undefined;
}

/** The theme's token rules, after those of any theme it `include`s. */
async function loadRules(uri: vscode.Uri | undefined, depth = 0): Promise<TokenRule[]> {
  if (!uri || depth > 5) return [];
  const theme = parseTheme(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
  const included = theme.include ? await loadRules(vscode.Uri.joinPath(uri, '..', theme.include), depth + 1) : [];
  return [...included, ...(theme.tokenColors ?? [])];
}
