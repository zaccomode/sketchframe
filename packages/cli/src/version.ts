// Replaced with package.json's version when esbuild bundles the CLI; the
// fallback is for running the sources directly in tests.
declare const SKETCHFRAME_VERSION: string | undefined;
export const version: string = typeof SKETCHFRAME_VERSION === 'string' ? SKETCHFRAME_VERSION : 'dev';
