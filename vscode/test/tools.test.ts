import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { tools } from '../../packages/core/src/tools.ts';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// VS Code reads tool declarations from package.json, but the tools themselves
// come from the shared core, so the two have to agree.
test('package.json declares every core tool, as the core describes it', () => {
  const declared = manifest.contributes.languageModelTools;
  assert.deepEqual(
    declared.map((tool: { name: string }) => tool.name),
    tools.map((tool) => `sketchframe_${tool.name}`),
  );
  for (const tool of tools) {
    const entry = declared.find((each: { name: string }) => each.name === `sketchframe_${tool.name}`);
    assert.equal(entry.modelDescription, tool.description, tool.name);
    assert.equal(entry.displayName, tool.title, tool.name);
    assert.deepEqual(entry.inputSchema, tool.inputSchema, tool.name);
  }
});
