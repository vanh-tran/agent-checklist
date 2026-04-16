import type { FastifyInstance } from "fastify";
import type { Store } from "./store.js";
import type { Broadcaster } from "./broadcast.js";
import type { ReadyFlag } from "./ready.js";
import type { HealthResponse, WsMessage } from "../shared/types.js";

export interface HttpDeps {
  store: Store;
  broadcaster: Broadcaster;
  ready: ReadyFlag;
  version: string;
  startedAt: string;
}

export async function registerHttpRoutes(app: FastifyInstance, deps: HttpDeps): Promise<void> {
  app.get("/api/health", async (): Promise<HealthResponse> => ({
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

  app.post<{ Params: { id: string } }>("/api/agents/:id/clear", async (req, reply) => {
    const removed = deps.store.removeAgent({ agentId: req.params.id });
    if (!removed) {
      reply.code(404).send({ error: `Agent "${req.params.id}" not found.` });
      return;
    }
    const msg: WsMessage = { type: "agent_removed", payload: { agentId: req.params.id } };
    deps.broadcaster.broadcast(msg);
    return { ok: true };
  });

  app.post("/api/board/clear", async () => {
    deps.store.clearAll();
    const msg: WsMessage = { type: "state", payload: deps.store.getState() };
    deps.broadcaster.broadcast(msg);
    return { ok: true };
  });
}
