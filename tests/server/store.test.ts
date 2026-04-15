import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../../src/server/store.ts";

let store = createStore();
beforeEach(() => {
  store = createStore();
});

test("registerAgent creates an agent with monotonic task ids", () => {
  const { agent } = store.registerAgent({
    agentId: "sess-1",
    name: "Login",
    tasks: ["Plan", "Build", "Test"],
  });
  assert.equal(agent.id, "sess-1");
  assert.equal(agent.tasks.length, 3);
  assert.deepEqual(
    agent.tasks.map((t) => t.id),
    ["sess-1-t0", "sess-1-t1", "sess-1-t2"],
  );
  assert.equal(agent.nextTaskSeq, 3);
  assert.equal(agent.connectionStatus, "connected");
  assert.equal(agent.source, "live");
  assert.ok(agent.startedAt);
  assert.equal(agent.lastActivityAt, agent.startedAt);
  for (const t of agent.tasks) assert.equal(t.status, "pending");
});

test("registerAgent called again with same id + same name is treated as re-register", () => {
  const first = store.registerAgent({ agentId: "s", name: "A", tasks: ["x"] });
  // simulate disconnect
  store.markAllDisconnected();
  const second = store.registerAgent({ agentId: "s", name: "A", tasks: ["should", "be", "ignored"] });
  assert.equal(second.reRegistered, true);
  assert.equal(second.agent.connectionStatus, "connected");
  // tasks unchanged
  assert.deepEqual(
    second.agent.tasks.map((t) => t.id),
    first.agent.tasks.map((t) => t.id),
  );
});

test("registerAgent with same id but different name errors", () => {
  store.registerAgent({ agentId: "s", name: "A", tasks: [] });
  assert.throws(
    () => store.registerAgent({ agentId: "s", name: "B", tasks: [] }),
    /different name/i,
  );
});
