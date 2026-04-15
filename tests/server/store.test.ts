import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
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

test("updateTask changes status and updates timestamps", async () => {
  const { agent } = store.registerAgent({ agentId: "a", name: "A", tasks: ["x"] });
  const t0 = agent.tasks[0]!;
  const before = t0.updatedAt;
  // force next ISO timestamp to be different
  await sleep(2);
  const res = store.updateTask({ agentId: "a", taskId: t0.id, status: "in_progress" });
  assert.equal(res.task.status, "in_progress");
  assert.notEqual(res.task.updatedAt, before);
  assert.equal(res.supersededTaskIds.length, 0);
  assert.equal(res.agent.connectionStatus, "connected");
});

test("setting a task to in_progress auto-reverts any other in_progress on same agent", () => {
  const { agent } = store.registerAgent({
    agentId: "a",
    name: "A",
    tasks: ["x", "y"],
  });
  store.updateTask({ agentId: "a", taskId: agent.tasks[0]!.id, status: "in_progress" });
  const res = store.updateTask({ agentId: "a", taskId: agent.tasks[1]!.id, status: "in_progress" });
  assert.equal(agent.tasks[0]!.status, "pending");
  assert.equal(agent.tasks[1]!.status, "in_progress");
  assert.deepEqual(res.supersededTaskIds, [agent.tasks[0]!.id]);
});

test("updateTask note semantics: omit preserves, empty string clears", () => {
  const { agent } = store.registerAgent({ agentId: "a", name: "A", tasks: ["x"] });
  const tid = agent.tasks[0]!.id;
  store.updateTask({ agentId: "a", taskId: tid, status: "in_progress", note: "hello" });
  assert.equal(agent.tasks[0]!.note, "hello");
  store.updateTask({ agentId: "a", taskId: tid, status: "completed" });
  assert.equal(agent.tasks[0]!.note, "hello", "omitted note preserves");
  store.updateTask({ agentId: "a", taskId: tid, status: "completed", note: "" });
  assert.equal(agent.tasks[0]!.note, undefined, "empty string clears note");
});

test("updateTask errors on unknown agent or task", () => {
  assert.throws(() => store.updateTask({ agentId: "x", taskId: "x-t0", status: "completed" }), /agent/i);
  store.registerAgent({ agentId: "a", name: "A", tasks: ["x"] });
  assert.throws(() => store.updateTask({ agentId: "a", taskId: "nope", status: "completed" }), /task/i);
});
