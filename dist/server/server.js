import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createStore } from "./store.js";
import { createBroadcaster } from "./broadcast.js";
import { createPersistence } from "./persistence.js";
import { createReadyFlag } from "./ready.js";
import { registerHttpRoutes } from "./http.js";
import { createMcpServer } from "./mcp.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = process.env.AGENT_CHECKLIST_STATE_FILE
    ?? path.join(process.env.HOME ?? "", ".agent-checklist", "state.json");
export async function startServer(opts) {
    const persistence = createPersistence({ filePath: opts.stateFilePath ?? STATE_FILE });
    const loaded = await persistence.load();
    const store = createStore(loaded);
    store.applyRestartRecovery();
    const broadcaster = createBroadcaster();
    const ready = createReadyFlag();
    const startedAt = new Date().toISOString();
    const app = Fastify({ logger: { level: process.env.AGENT_CHECKLIST_LOG_LEVEL ?? "warn" } });
    // Serve built React assets from dist/web (resolved relative to this file at runtime).
    const webRoot = path.resolve(__dirname, "../web");
    await app.register(fastifyStatic, { root: webRoot, prefix: "/", decorateReply: false });
    // REST API
    await registerHttpRoutes(app, {
        store, broadcaster, ready, version: opts.version, startedAt,
    });
    // WebSocket
    await app.register(websocket);
    app.register(async (scope) => {
        scope.get("/ws", { websocket: true }, (socket) => {
            const client = {
                send: (data) => socket.send(data),
                close: () => socket.close(),
            };
            broadcaster.add(client);
            const initial = { type: "state", payload: store.getState() };
            socket.send(JSON.stringify(initial));
            socket.on("close", () => broadcaster.remove(client));
        });
    });
    // MCP (Streamable HTTP, stateless — one MCP server + transport per request,
    // because McpServer.connect() can only be called once per instance)
    const mcpCtx = { store, broadcaster };
    app.all("/mcp", async (req, reply) => {
        const mcp = createMcpServer(mcpCtx);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        reply.hijack();
        await mcp.connect(transport);
        await transport.handleRequest(req.raw, reply.raw, req.body);
    });
    // Persist on every mutation: subscribe to the broadcaster
    const saver = {
        send: (_data) => { persistence.schedule(store.getState()); },
        close: () => { },
    };
    broadcaster.add(saver);
    await app.listen({ port: opts.port, host: "127.0.0.1" });
    ready.markReady();
    return { app, store, broadcaster, persistence, ready, port: opts.port, startedAt };
}
//# sourceMappingURL=server.js.map