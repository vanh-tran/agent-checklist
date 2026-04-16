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

// ── Integration test: end-to-end over Streamable HTTP ──────────────────────

import { startServer } from "../../src/server/server.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

async function callMcp(port: number, method: string, params: unknown): Promise<any> {
  const r = await fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    // Parse SSE: collect "data:" lines, return last JSON-RPC message
    const text = await r.text();
    const lines = text.split("\n").filter((l) => l.startsWith("data:"));
    const last = lines.at(-1);
    return last ? JSON.parse(last.slice("data:".length).trim()) : {};
  }
  return r.json();
}

test("integration: register_agent + update_task via MCP over HTTP", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ac-mcp-"));
  const port = 52000 + Math.floor(Math.random() * 500);
  const handle = await startServer({
    port,
    stateFilePath: path.join(dir, "state.json"),
    version: "test",
  });
  try {
    // initialize (required by Streamable HTTP before tools/call)
    await callMcp(port, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    const reg = await callMcp(port, "tools/call", {
      name: "register_agent",
      arguments: { agentId: "sess-x", name: "Integration", tasks: ["t1", "t2"] },
    });
    // JSON-RPC response: { jsonrpc, id, result: { content: [...] } }
    assert.ok(reg.result, `register_agent failed: ${JSON.stringify(reg)}`);
    assert.equal(handle.store.getState().agents["sess-x"]?.tasks.length, 2);

    const upd = await callMcp(port, "tools/call", {
      name: "update_task",
      arguments: { agentId: "sess-x", taskId: "sess-x-t0", status: "in_progress" },
    });
    assert.ok(upd.result, `update_task failed: ${JSON.stringify(upd)}`);
    assert.equal(handle.store.getState().agents["sess-x"]!.tasks[0]!.status, "in_progress");
  } finally {
    await handle.app.close();
    rmSync(dir, { recursive: true });
  }
});