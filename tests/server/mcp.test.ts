import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../../src/server/store.ts";
import { createBroadcaster } from "../../src/server/broadcast.ts";
import { createMcpToolHandlers } from "../../src/server/mcp.ts";

let ctx = makeCtx();
beforeEach(() => { ctx = makeCtx(); });

function makeCtx() {
  const store = createStore();
  const broadcaster = createBroadcaster();
  const events: unknown[] = [];
  broadcaster.add({ send: (d) => events.push(JSON.parse(d)) });
  const handlers = createMcpToolHandlers({ store, broadcaster });
  return { store, broadcaster, events, handlers };
}

test("register_agent tool broadcasts agent_updated", async () => {
  const res = await ctx.handlers.register_agent({
    agentId: "s1", name: "Build login", tasks: ["a", "b"],
  });
  assert.match(res.content[0]!.text, /Registered/);
  assert.equal(ctx.events.length, 1);
  const ev = ctx.events[0] as { type: string; payload: { id: string } };
  assert.equal(ev.type, "agent_updated");
  assert.equal(ev.payload.id, "s1");
});

test("update_task broadcasts task_updated and any superseded tasks", async () => {
  await ctx.handlers.register_agent({ agentId: "s1", name: "A", tasks: ["x", "y"] });
  ctx.events.length = 0;
  await ctx.handlers.update_task({ agentId: "s1", taskId: "s1-t0", status: "in_progress" });
  await ctx.handlers.update_task({ agentId: "s1", taskId: "s1-t1", status: "in_progress" });
  const types = ctx.events.map((e: any) => e.type);
  // 1st call: one task_updated. 2nd call: task_updated for t1 + task_updated for superseded t0.
  assert.equal(ctx.events.length, 3);
  assert.deepEqual(types, ["task_updated", "task_updated", "task_updated"]);
});

test("register_agent duplicate-with-different-name returns MCP error", async () => {
  await ctx.handlers.register_agent({ agentId: "s1", name: "A", tasks: [] });
  const res = await ctx.handlers.register_agent({ agentId: "s1", name: "B", tasks: [] });
  assert.equal(res.isError, true);
  assert.match(res.content[0]!.text, /different name/i);
});

test("remove_task on in_progress returns MCP error", async () => {
  await ctx.handlers.register_agent({ agentId: "s1", name: "A", tasks: ["x"] });
  await ctx.handlers.update_task({ agentId: "s1", taskId: "s1-t0", status: "in_progress" });
  const res = await ctx.handlers.remove_task({ agentId: "s1", taskId: "s1-t0" });
  assert.equal(res.isError, true);
});

test("get_board returns the current state as JSON text", async () => {
  await ctx.handlers.register_agent({ agentId: "s1", name: "A", tasks: ["x"] });
  const res = await ctx.handlers.get_board({});
  const parsed = JSON.parse(res.content[0]!.text);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.agents.s1.id, "s1");
});