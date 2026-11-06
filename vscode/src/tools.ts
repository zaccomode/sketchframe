// The Sketchframe MCP server's tools as VS Code language-model tools, so
// agents inside VS Code (Copilot's agent mode and others) can read
// Sketchframes the same way. Each tool is declared in package.json's
// `languageModelTools`; test/tools.test.ts keeps the two in step.

import * as vscode from 'vscode';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tools } from '../../packages/core/src/tools.ts';
import type { Tool } from '../../packages/core/src/tools.ts';

/** VS Code tool names carry a prefix, so they don't collide with other extensions'. */
export const toolPrefix = 'sketchframe_';

export function registerLanguageModelTools(): vscode.Disposable[] {
  // Older VS Codes, and editors built on them, may not have the API.
  if (typeof vscode.lm?.registerTool !== 'function') return [];
  return tools.map((tool) => vscode.lm.registerTool(`${toolPrefix}${tool.name}`, languageModelTool(tool)));
}

function languageModelTool(tool: Tool): vscode.LanguageModelTool<Record<string, unknown>> {
  return {
    prepareInvocation(options) {
      const target = [options.input.file, options.input.node].filter((value) => typeof value === 'string').join(' → ');
      return { invocationMessage: `${tool.title}${target ? `: ${target}` : ''}` };
    },
    invoke(options) {
      // The tools read through Node's file system, so relative paths are
      // relative to the first workspace folder on this machine.
      const cwd = vscode.workspace.workspaceFolders?.find((folder) => folder.uri.scheme === 'file')?.uri.fsPath ?? process.cwd();
      let content;
      try {
        content = tool.run(options.input ?? {}, cwd);
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error));
      }
      const parts = content.map((part) => {
        if (part.type === 'text') return new vscode.LanguageModelTextPart(part.text);
        // Tool results only carry text in this API version, so the image is
        // saved where the agent can open it.
        const file = join(mkdtempSync(join(tmpdir(), 'sketchframe-')), 'screenshot.png');
        writeFileSync(file, Buffer.from(part.data, 'base64'));
        return new vscode.LanguageModelTextPart(`Image saved to ${file}`);
      });
      return new vscode.LanguageModelToolResult(parts);
    },
  };
}
