/**
 * Stdio MCP bridge — ensures the background HTTP server is running, then
 * proxies every tool call from Claude Code (stdio) to the HTTP MCP endpoint.
 *
 * This exists to avoid a timing race: Claude Code connects to `url`-type MCP
 * servers synchronously at session start, before hooks fire. By registering
 * the MCP server as a `command` instead, Claude Code spawns this process
 * itself, so it is always available when the session begins.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export async function startStdioMcp(port: number, version: string): Promise<void> {
  const mcpUrl = new URL(`http://localhost:${port}/mcp`);

  // Connect to the background HTTP MCP server as a client.
  const httpClient = new Client({ name: "agent-checklist-stdio-proxy", version });
  await httpClient.connect(new StreamableHTTPClientTransport(mcpUrl));

  // Build a low-level stdio Server that proxies tools/list and tools/call to
  // the HTTP client. Using the base Server (not McpServer) lets us forward
  // tool schemas dynamically without needing Zod definitions at build time.
  const stdioServer = new Server(
    { name: "agent-checklist", version },
    {
      capabilities: { tools: {} },
      instructions:
        "Publish the calling agent's task checklist and real-time progress to the local dashboard.",
    },
  );

  stdioServer.setRequestHandler(ListToolsRequestSchema, async (request) => {
    return await httpClient.listTools(request.params);
  });

  stdioServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    return await httpClient.callTool(request.params);
  });

  const stdioTransport = new StdioServerTransport();
  await stdioServer.connect(stdioTransport);

  // Keep alive until stdin closes.
  await new Promise<void>((resolve) => {
    process.stdin.on("end", resolve);
    process.stdin.on("close", resolve);
  });
}
