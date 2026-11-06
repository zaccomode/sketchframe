// `sketchframe init`: sets a repository up so Claude Code (locally or on the
// web) can read its Sketchframes, using only committed files: the MCP server
// in .mcp.json, the skill in .claude/skills, and the git diff driver in
// .gitattributes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

declare const SKETCHFRAME_SKILL: string | undefined;

/** skills/sketchframe/SKILL.md, embedded in the bundle by esbuild. */
export function skillText(): string {
  const skill = typeof SKETCHFRAME_SKILL === 'string' ? SKETCHFRAME_SKILL : (globalThis as { SKETCHFRAME_SKILL?: string }).SKETCHFRAME_SKILL;
  if (typeof skill !== 'string') throw new Error('This build of sketchframe has no skill embedded.');
  return skill;
}

export const mcpServer = { command: 'npx', args: ['-y', 'sketchframe', 'mcp'] };
export const gitattributesLine = '*.sketchframe diff=sketchframe';

export type InitOptions = { mcp?: boolean; skill?: boolean; gitattributes?: boolean; force?: boolean };

/** Returns one line per file, saying what it did. */
export function init(root: string, options: InitOptions = {}): string[] {
  const report: string[] = [];

  if (options.mcp !== false) {
    const file = join(root, '.mcp.json');
    let config: { mcpServers?: Record<string, unknown> } = {};
    if (existsSync(file)) {
      try {
        config = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        throw new Error(`${file} isn't valid JSON; fix it or pass --no-mcp.`);
      }
    }
    if (config.mcpServers?.sketchframe && !options.force) {
      report.push('.mcp.json: already has a sketchframe server (left as it is)');
    } else {
      config.mcpServers = { ...config.mcpServers, sketchframe: mcpServer };
      writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
      report.push('.mcp.json: added the sketchframe MCP server');
    }
  }

  if (options.skill !== false) {
    const file = join(root, '.claude', 'skills', 'sketchframe', 'SKILL.md');
    if (existsSync(file) && !options.force) {
      report.push('.claude/skills/sketchframe/SKILL.md: already there (left as it is; --force replaces it)');
    } else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, skillText());
      report.push('.claude/skills/sketchframe/SKILL.md: added the skill');
    }
  }

  if (options.gitattributes !== false) {
    const file = join(root, '.gitattributes');
    const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (existing.split(/\r?\n/).some((line) => line.trim().startsWith('*.sketchframe '))) {
      report.push('.gitattributes: already has a *.sketchframe rule (left as it is)');
    } else {
      const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
      writeFileSync(file, `${existing}${separator}${gitattributesLine}\n`);
      report.push('.gitattributes: added the diff driver; enable it with: git config diff.sketchframe.textconv "npx -y sketchframe cat"');
    }
  }

  return report;
}
