import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs, run } from '../src/cli.ts';

// esbuild embeds the skill in the bundle; the sources read it from a global.
(globalThis as { SKETCHFRAME_SKILL?: string }).SKETCHFRAME_SKILL = readFileSync(
  new URL('../../../skills/sketchframe/SKILL.md', import.meta.url),
  'utf8',
);

const fixture = fileURLToPath(new URL('../../core/test/fixtures/Cards.sketchframe', import.meta.url));

function capture(argv: string[]) {
  let output = '';
  const code = run(argv, (text) => (output += text));
  return { code, output };
}

test('parses flags in either form', () => {
  assert.deepEqual(parseArgs(['outline', 'a.sketchframe', '--depth', '2', '-o=x.png', '--help']), {
    positional: ['outline', 'a.sketchframe'],
    flags: { depth: '2', o: 'x.png', help: true },
  });
});

test('packs, outlines and crops', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sketchframe-cli-'));
  try {
    const archive = join(dir, 'nested', 'Cards.sketchframe');
    assert.equal(capture(['pack', fixture, archive]).code, 0);
    const { output } = capture(['outline', archive, 'Tilted']);
    assert.match(output, /^Cards: 200×150 pt/);
    assert.match(output, /Tilted \[group\] 80×40 n3/);
    const out = join(dir, 'card.png');
    assert.match(capture(['crop', archive, 'n2', '-o', out]).output, /120×80 px at 2x/);
    assert.ok(existsSync(out));
    assert.match(capture(['cat', archive]).output, /## annotations\.json/);
    assert.match(capture(['list', dir]).output, /nested\/Cards\.sketchframe/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('rejects unknown commands and bad flags', () => {
  assert.throws(() => run(['bogus']), /Unknown command/);
  assert.throws(() => run(['outline', fixture, '--depth', 'x']), /--depth takes a number/);
});

/** Talks to the MCP server over stdio, as a client would. */
async function mcp(messages: object[]): Promise<any[]> {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/mcp-main.ts', import.meta.url))], {
    cwd: fileURLToPath(new URL('../../core/test/fixtures/', import.meta.url)),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  const responses: any[] = [];
  const expected = messages.filter((message) => 'id' in message).length;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out; got ${JSON.stringify(responses)}`));
    }, 10000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        responses.push(JSON.parse(buffer.slice(0, newline)));
        buffer = buffer.slice(newline + 1);
      }
      if (responses.length >= expected) {
        clearTimeout(timer);
        child.stdin.end();
        resolve(responses);
      }
    });
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

test('serves the tools over MCP', async () => {
  const [init, list, outline, screenshot, missing, unknown] = await mcp([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_outline', arguments: { file: 'Cards.sketchframe' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_screenshot', arguments: { file: 'Cards.sketchframe', node: 'Card' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_node', arguments: { file: 'Cards.sketchframe', node: 'Nope' } } },
    { jsonrpc: '2.0', id: 6, method: 'nope' },
  ]);
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'sketchframe');
  assert.deepEqual(
    list.result.tools.map((tool: any) => tool.name),
    ['list_sketchframes', 'get_outline', 'get_node', 'get_screenshot', 'get_tokens', 'get_annotations', 'get_code'],
  );
  assert.match(outline.result.content[0].text, /Card \[rectangle\]/);
  assert.equal(screenshot.result.content[0].type, 'image');
  assert.equal(screenshot.result.content[0].mimeType, 'image/png');
  assert.equal(missing.result.isError, true);
  assert.equal(unknown.error.code, -32601);
});

test('init sets a repository up and leaves existing setup alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sketchframe-init-'));
  try {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    writeFileSync(join(dir, '.gitattributes'), '*.png binary');
    const first = capture(['init', dir]).output;
    assert.match(first, /added the sketchframe MCP server/);
    const config = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    assert.deepEqual(Object.keys(config.mcpServers), ['other', 'sketchframe']);
    assert.deepEqual(config.mcpServers.sketchframe.args, ['-y', 'sketchframe', 'mcp']);
    assert.match(readFileSync(join(dir, '.claude/skills/sketchframe/SKILL.md'), 'utf8'), /^---\nname: sketchframe/);
    assert.equal(readFileSync(join(dir, '.gitattributes'), 'utf8'), '*.png binary\n*.sketchframe diff=sketchframe\n');
    const second = capture(['init', dir]).output;
    assert.match(second, /already has a sketchframe server/);
    assert.match(second, /already has a \*\.sketchframe rule/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
