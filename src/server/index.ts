import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { addClient, removeClient, broadcast } from "./broadcast.js";
import { getState } from "./store.js";
import { createMcpServer } from "./mcp.js";

const app = Fastify({ logger: true });
await app.register(websocket);

// ── WebSocket: push board state to browser clients ────────────────────────────
app.register(async (app) => {
  app.get("/ws", { websocket: true }, (socket) => {
    const client = { send: (data: string) => socket.send(data) };
    addClient(client);

    // Send full state on connect
    socket.send(JSON.stringify({ type: "state", payload: getState() }));

    socket.on("close", () => removeClient(client));
  });
});

// ── MCP: HTTP/SSE endpoint for Claude Code agents ──────────────

app.all("/mcp", async (req, reply) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  reply.hijack();
  await mcpServer.connect(transport);
  await transport.handleRequest(req.raw, reply.raw, req.body);
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/api/health", async () => ({ ok: true }));
app.get("/api/state", async () => getState());

const PORT = Number(process.env.PORT ?? 3000);
await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`\n🚀 agent-checklist running at http://localhost:${PORT}`);
console.log(`📡 MCP endpoint: http://localhost:${PORT}/mcp`);
console.log(`🖥️  Dashboard:    http://localhost:${PORT}\n`);
