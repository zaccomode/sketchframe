// Bundles the two halves separately: the extension host runs in Node and
// can import `vscode`; the webview runs in a browser sandbox and can't.
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

const contexts = await Promise.all([
  esbuild.context({
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.cjs',
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
    // Prefer packages' ES module builds. jsonc-parser's default UMD build
    // loads its own files with a require esbuild can't follow, which left
    // `./impl/format` missing at runtime.
    mainFields: ['module', 'main'],
  }),
  esbuild.context({
    ...shared,
    entryPoints: { webview: 'webview/main.ts' },
    outdir: 'dist',
    platform: 'browser',
    format: 'iife',
    // The codicon font, referenced from codicon.css, lands next to
    // webview.css under a fixed name so .vscodeignore can list it.
    loader: { '.css': 'css', '.ttf': 'file' },
    assetNames: '[name]',
  }),
]);

if (watch) {
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(contexts.map((context) => context.rebuild()));
  await Promise.all(contexts.map((context) => context.dispose()));
}
