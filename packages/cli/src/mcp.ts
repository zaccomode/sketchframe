// A stdio MCP server for the Sketchframe tools. Hand-rolled JSON-RPC rather
// than the MCP SDK, so the whole server bundles into one dependency-free file
// that installs anywhere, including cloud sessions with a locked-down network.
// Messages are newline-delimited JSON on stdin and stdout; logs go to stderr.

import { createInterface } from 'node:readline';
import { tools, toolNamed } from '@sketchframe/core/tools';
import { version } from './version.ts';

/** Newest first. A client asking for one of these gets it; others get the newest. */
const protocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type Request = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> };

const instructions = `Sketchframe tools read .sketchframe design files exported from Sketch: a preview image plus the full design tree.
Workflow: list_sketchframes (if you don't know the file) → get_outline → get_screenshot of the whole frame → pick the layers to build → get_node and get_screenshot for each → get_annotations for designers' notes (follow them) → get_tokens to map colors onto the codebase's variables. get_code gives an HTML/CSS starting point for a layer.`;

export function startServer(cwd = process.cwd()) {
  const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const reply = (id: Request['id'], result: unknown) => send({ jsonrpc: '2.0', id, result });
  const fail = (id: Request['id'], code: number, message: string) => send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  const handle = (request: Request) => {
    const { id, method, params = {} } = request;
    const isNotification = id === undefined;
    switch (method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        reply(id, {
          protocolVersion: protocolVersions.includes(requested) ? requested : protocolVersions[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'sketchframe', title: 'Sketchframe', version },
          instructions,
        });
        return;
      }
      case 'ping':
        reply(id, {});
        return;
      case 'tools/list':
        reply(id, {
          tools: tools.map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: { readOnlyHint: true, openWorldHint: false },
          })),
        });
        return;
      case 'tools/call': {
        const name = typeof params.name === 'string' ? params.name : '';
        const tool = toolNamed(name);
        if (!tool) {
          fail(id, -32602, `Unknown tool: ${name}`);
          return;
        }
        const args = typeof params.arguments === 'object' && params.arguments !== null ? (params.arguments as Record<string, unknown>) : {};
        try {
          reply(id, { content: tool.run(args, cwd) });
        } catch (error) {
          // Tool errors are results, so the model sees them and can recover.
          reply(id, { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true });
        }
        return;
      }
      case 'resources/list':
        reply(id, { resources: [] });
        return;
      case 'prompts/list':
        reply(id, { prompts: [] });
        return;
      default:
        if (!isNotification) fail(id, -32601, `Method not found: ${method}`);
    }
  };

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      fail(null, -32700, 'Parse error');
      return;
    }
    for (const request of Array.isArray(message) ? message : [message]) {
      if (typeof request !== 'object' || request === null || typeof (request as Request).method !== 'string') {
        // Responses to requests we never send, or junk.
        continue;
      }
      try {
        handle(request as Request);
      } catch (error) {
        fail((request as Request).id, -32603, error instanceof Error ? error.message : String(error));
      }
    }
  });
  // When the client closes stdin, nothing keeps the process alive, so it
  // exits once the last reply has been written.
  process.stderr.write(`sketchframe MCP server ${version} on stdio (cwd ${cwd})\n`);
}
