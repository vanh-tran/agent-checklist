// import Fastify from "fastify";
// import websocket from "@fastify/websocket";
// import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// import { createBroadcaster, type Broadcaster } from "./broadcast";
// import { getState } from "./store";
// import { createMcpServer } from "./mcp";

// const app = Fastify({ logger: true });
// await app.register(websocket);
// const broadcaster = createBroadcaster();

// // ── WebSocket: push board state to browser clients ────────────────────────────
// app.register(async (app) => {
//   app.get("/ws", { websocket: true }, (socket) => {
//     const client = { send: (data: string) => socket.send(data) };
//     broadcaster.add(client);

//     // Send full state on connect
//     socket.send(JSON.stringify({ type: "state", payload: getState() }));

//     socket.on("close", () => broadcaster.remove(client));
//   });
// });

// // ── MCP: HTTP/SSE endpoint for Claude Code agents ──────────────

// app.all("/mcp", async (req, reply) => {
//   const transport = new StreamableHTTPServerTransport({
//     sessionIdGenerator: undefined, // stateless
//   });
//   const mcpServer = createMcpServer();
//   reply.hijack();
//   await mcpServer.connect(transport);
//   await transport.handleRequest(req.raw, reply.raw, req.body);
// });

// // ── Health check ──────────────────────────────────────────────────────────────
// app.get("/api/health", async () => ({ ok: true }));
// app.get("/api/state", async () => getState());

// const PORT = Number(process.env.PORT ?? 3000);
// await app.listen({ port: PORT, host: "0.0.0.0" });
// console.log(`\n🚀 agent-checklist running at http://localhost:${PORT}`);
// console.log(`📡 MCP endpoint: http://localhost:${PORT}/mcp`);
// console.log(`🖥️  Dashboard:    http://localhost:${PORT}\n`);
