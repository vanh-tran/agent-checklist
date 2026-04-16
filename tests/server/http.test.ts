import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { createStore } from "../../src/server/store.ts";
import { createBroadcaster } from "../../src/server/broadcast.ts";
import { createReadyFlag } from "../../src/server/ready.ts";
import { registerHttpRoutes } from "../../src/server/http.ts";

let app: FastifyInstance;
const startedAt = new Date().toISOString();

beforeEach(async () => {
  const store = createStore();
  const broadcaster = createBroadcaster();
  const ready = createReadyFlag();
  app = Fastify();
  await registerHttpRoutes(app, {
    store, broadcaster, ready, version: "0.1.3-test", startedAt,
  });
  await app.ready();
});

afterEach(async () => { await app.close(); });

test("GET /api/health returns service metadata immediately", async () => {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.service, "agent-checklist");
  assert.equal(body.version, "0.1.3-test");
  assert.equal(body.pid, process.pid);
  assert.equal(body.startedAt, startedAt);
});

test("GET /api/ready returns 503 before markReady, 200 after", async () => {
  const before = await app.inject({ method: "GET", url: "/api/ready" });
  assert.equal(before.statusCode, 503);
  // Instead, spin a fresh app with ready flagged.
  const r2 = createReadyFlag();
  r2.markReady();
  const app2 = Fastify();
  await registerHttpRoutes(app2, {
    store: createStore(), broadcaster: createBroadcaster(), ready: r2,
    version: "x", startedAt,
  });
  await app2.ready();
  const after = await app2.inject({ method: "GET", url: "/api/ready" });
  assert.equal(after.statusCode, 200);
  await app2.close();
});

test("GET /api/state returns current board", async () => {
  const res = await app.inject({ method: "GET", url: "/api/state" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.schemaVersion, 1);
  assert.deepEqual(body.agents, {});
});

test("POST /api/agents/:id/clear removes the agent and broadcasts", async () => {
  const store = createStore();
  const broadcaster = createBroadcaster();
  const events: unknown[] = [];
  broadcaster.add({ send: (d) => events.push(JSON.parse(d)) });
  const app2 = Fastify();
  await registerHttpRoutes(app2, {
    store, broadcaster, ready: createReadyFlag(), version: "x", startedAt,
  });
  await app2.ready();
  store.registerAgent({ agentId: "a", name: "A", tasks: [] });
  const res = await app2.inject({ method: "POST", url: "/api/agents/a/clear" });
  assert.equal(res.statusCode, 200);
  assert.equal(store.getState().agents.a, undefined);
  assert.equal(events.length, 1);
  const ev = events[0] as { type: string; payload: { agentId: string } };
  assert.equal(ev.type, "agent_removed");
  assert.equal(ev.payload.agentId, "a");
  await app2.close();
});

test("POST /api/agents/:id/clear on unknown agent returns 404", async () => {
  const res = await app.inject({ method: "POST", url: "/api/agents/none/clear" });
  assert.equal(res.statusCode, 404);
});

test("POST /api/board/clear wipes all agents and broadcasts state", async () => {
  const store = createStore();
  const broadcaster = createBroadcaster();
  const events: unknown[] = [];
  broadcaster.add({ send: (d) => events.push(JSON.parse(d)) });
  const app2 = Fastify();
  await registerHttpRoutes(app2, {
    store, broadcaster, ready: createReadyFlag(), version: "x", startedAt,
  });
  await app2.ready();
  store.registerAgent({ agentId: "a", name: "A", tasks: [] });
  const res = await app2.inject({ method: "POST", url: "/api/board/clear" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(store.getState().agents, {});
  const last = events[events.length - 1] as { type: string };
  assert.equal(last.type, "state");
  await app2.close();
});
