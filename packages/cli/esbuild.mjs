// Bundles the CLI and the MCP server into single files with every dependency
// inlined: what npm publishes, and what a repository can commit and run with
// plain `node` where nothing can be downloaded.
import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'));
// The skill lives at the repository root, where people browsing it find it;
// the CLI embeds it for `sketchframe init` and `sketchframe skill`.
const skill = readFileSync(new URL('../../skills/sketchframe/SKILL.md', import.meta.url), 'utf8');

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  minify: false,
  legalComments: 'inline',
  define: { SKETCHFRAME_VERSION: JSON.stringify(version), SKETCHFRAME_SKILL: JSON.stringify(skill) },
  logLevel: 'info',
};

await Promise.all([
  esbuild.build({ ...shared, entryPoints: ['src/main.ts'], outfile: 'dist/sketchframe.cjs' }),
  esbuild.build({ ...shared, entryPoints: ['src/mcp-main.ts'], outfile: 'dist/sketchframe-mcp.cjs' }),
]);
