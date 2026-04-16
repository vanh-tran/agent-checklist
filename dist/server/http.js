export async function registerHttpRoutes(app, deps) {
    app.get("/api/health", async () => ({
        service: "agent-checklist",
        version: deps.version,
        pid: process.pid,
        startedAt: deps.startedAt,
    }));
    app.get("/api/ready", async (_req, reply) => {
        if (!deps.ready.isReady()) {
            reply.code(503).send({ ok: false });
            return;
        }
        return { ok: true };
    });
    app.get("/api/state", async () => deps.store.getState());
    app.post("/api/agents/:id/clear", async (req, reply) => {
        const removed = deps.store.removeAgent({ agentId: req.params.id });
        if (!removed) {
            reply.code(404).send({ error: `Agent "${req.params.id}" not found.` });
            return;
        }
        const msg = { type: "agent_removed", payload: { agentId: req.params.id } };
        deps.broadcaster.broadcast(msg);
        return { ok: true };
    });
    app.post("/api/board/clear", async () => {
        deps.store.clearAll();
        const msg = { type: "state", payload: deps.store.getState() };
        deps.broadcaster.broadcast(msg);
        return { ok: true };
    });
}
//# sourceMappingURL=http.js.map