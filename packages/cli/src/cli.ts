#!/usr/bin/env node
// `sketchframe`: read .sketchframe design files from the command line. Each
// reading command matches an MCP tool, so an agent without the MCP server
// installed gets the same results through its shell.

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { catText, htmlForNode, outline, requireNode, summary, toJSON, nodeContext, tokens, annotations } from '@sketchframe/core';
import { cropPreview } from '@sketchframe/core/crop';
import { extract, findSketchframes, openFiles, openSketchframe, pack } from '@sketchframe/core/node';
import { startServer } from './mcp.ts';
import { version } from './version.ts';

const usage = `sketchframe ${version}: read .sketchframe design files

Usage:
  sketchframe list [dir]                        Find .sketchframe files (default: current directory)
  sketchframe outline <file> [node] [--depth N] A compact tree of ids, names, types and sizes
  sketchframe node <file> <node> [--depth N]    One layer's subtree with styles and tokens resolved
  sketchframe crop <file> [node] [-o out.png] [--padding N]
                                                The preview, or one layer's region of it, as a PNG
  sketchframe tokens <file>                     Color tokens, shared styles and reused style values
  sketchframe annotations <file>                Designers' notes, with the layers they're attached to
  sketchframe code <file> <node>                An HTML/CSS starting point for a layer
  sketchframe cat <file>                        A stable text rendering (used as a git diff driver)
  sketchframe extract <file> <dir>              Unpack an archive into a folder
  sketchframe pack <dir> <file>                 Pack a folder (or legacy package) into an archive
  sketchframe mcp                               Run the MCP server on stdio

<node> is an id from the outline (n4), a sketchId, a layer path (Header/Title)
or a unique layer name. <file> can be a .sketchframe archive or a legacy
.sketchframe folder.

Docs: https://github.com/zaccomode/sketchframe/blob/main/docs/agents.md`;

type Parsed = { positional: string[]; flags: Record<string, string | true> };

/** `--depth 2`, `--depth=2`, `-o out.png`; everything else is positional. */
export function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const takesValue = new Set(['depth', 'padding', 'o', 'output']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const match = /^--?([a-zA-Z][\w-]*)(?:=(.*))?$/.exec(arg);
    if (!match || arg === '-') {
      positional.push(arg);
      continue;
    }
    const [, name, inline] = match;
    if (inline !== undefined) flags[name] = inline;
    else if (takesValue.has(name) && i + 1 < argv.length) flags[name] = argv[++i];
    else flags[name] = true;
  }
  return { positional, flags };
}

function integer(value: string | true | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (value === true || !Number.isFinite(n) || n < 0) throw new UsageError(`--${name} takes a number.`);
  return n;
}

class UsageError extends Error {}

function need(positional: string[], index: number, what: string): string {
  const value = positional[index];
  if (value === undefined) throw new UsageError(`Missing ${what}.`);
  return value;
}

export function run(argv: string[], out: (text: string) => void = (text) => process.stdout.write(text)): number {
  const { positional, flags } = parseArgs(argv);
  const [command, ...rest] = positional;
  const print = (text: string) => out(text.endsWith('\n') ? text : `${text}\n`);

  if (flags.version || flags.v) {
    print(version);
    return 0;
  }
  if (!command || command === 'help' || flags.help || flags.h) {
    print(usage);
    return command || flags.help || flags.h ? 0 : 1;
  }

  switch (command) {
    case 'list':
    case 'ls': {
      const found = findSketchframes(resolve(rest[0] ?? '.'));
      print(found.length ? found.join('\n') : 'No .sketchframe files found.');
      return 0;
    }
    case 'outline': {
      const frame = openSketchframe(need(rest, 0, '<file>'));
      const start = rest[1] ? requireNode(frame, rest[1]) : frame.root;
      print(`${summary(frame)}\n\n${outline(frame, start, { depth: integer(flags.depth, 'depth') })}`);
      return 0;
    }
    case 'node': {
      const frame = openSketchframe(need(rest, 0, '<file>'));
      const node = requireNode(frame, need(rest, 1, '<node>'));
      print(toJSON(nodeContext(frame, node, { depth: integer(flags.depth, 'depth') })));
      return 0;
    }
    case 'crop':
    case 'screenshot': {
      const file = need(rest, 0, '<file>');
      const frame = openSketchframe(file);
      const node = rest[1] ? requireNode(frame, rest[1]) : undefined;
      const crop = cropPreview(frame, node, integer(flags.padding, 'padding') ?? 0);
      const output = flags.o ?? flags.output;
      // Without -o, write somewhere that won't litter the repository.
      const target =
        typeof output === 'string'
          ? output
          : join(tmpdir(), `${basename(file, '.sketchframe').replace(/[^\w.-]+/g, '-')}${node ? `-${node.id}` : ''}.png`);
      writeFileSync(target, crop.png);
      print(`${resolve(target)} (${crop.region.width}×${crop.region.height} px at ${frame.preview.scale}x)`);
      return 0;
    }
    case 'tokens': {
      print(toJSON(tokens(openSketchframe(need(rest, 0, '<file>')))));
      return 0;
    }
    case 'annotations': {
      const list = annotations(openSketchframe(need(rest, 0, '<file>')));
      print(list.length ? toJSON(list) : 'No annotations.');
      return 0;
    }
    case 'code': {
      const frame = openSketchframe(need(rest, 0, '<file>'));
      print(htmlForNode(frame, requireNode(frame, need(rest, 1, '<node>'))));
      return 0;
    }
    case 'cat': {
      out(catText(openFiles(need(rest, 0, '<file>'))));
      return 0;
    }
    case 'extract': {
      const paths = extract(need(rest, 0, '<file>'), need(rest, 1, '<dir>'));
      print(`Extracted ${paths.length} files to ${rest[1]}.`);
      return 0;
    }
    case 'pack': {
      pack(need(rest, 0, '<dir>'), need(rest, 1, '<file>'));
      print(`Packed ${rest[0]} into ${rest[1]}.`);
      return 0;
    }
    default:
      throw new UsageError(`Unknown command "${command}".`);
  }
}

export function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'mcp') {
    startServer();
    return;
  }
  try {
    process.exitCode = run(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`sketchframe: ${message}\n`);
    if (error instanceof UsageError) process.stderr.write(`Run "sketchframe help" for usage.\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
