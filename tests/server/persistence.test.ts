import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPersistence } from "../../src/server/persistence.ts";
import type { BoardState } from "../../src/shared/types.ts";

function tempStatePath(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "ac-persist-"));
    return path.join(dir, "state.json");
}

test("load returns empty state when file is missing", async () => {
    const p = createPersistence({ filePath: tempStatePath() });
    const state = await p.load();
    assert.equal(state.schemaVersion, 1);
    assert.deepEqual(state.agents, {});
});

test("save then load round-trips", async () => {
const file = tempStatePath();
const p = createPersistence({ filePath: file });
const state: BoardState = {
    schemaVersion: 1,
    agents: {
    a1: {
        id: "a1",
        name: "A",
        tasks: [],
        nextTaskSeq: 0,
        source: "live",
        connectionStatus: "connected",
        startedAt: "2026-04-15T00:00:00Z",
        lastActivityAt: "2026-04-15T00:00:00Z",
    },
    },
};
p.schedule(state);
await p.flush();
const loaded = await p.load();
assert.deepEqual(loaded, state);
rmSync(path.dirname(file), { recursive: true });
});

test("schedule debounces multiple writes within window", async () => {
    const file = tempStatePath();
    const p = createPersistence({ filePath: file, debounceMs: 50 });
    const base: BoardState = { schemaVersion: 1, agents: {} };
  
    p.schedule({ ...base, agents: { a: { ...fakeAgent("a") } } });
    p.schedule({ ...base, agents: { b: { ...fakeAgent("b") } } });
    // no file yet
    assert.equal(existsSync(file), false);
  
    await p.flush();
    const loaded = JSON.parse(readFileSync(file, "utf8")) as BoardState;
    assert.ok(loaded.agents.b, "final scheduled state is persisted");
    assert.equal(loaded.agents.a, undefined);
    rmSync(path.dirname(file), { recursive: true });
  });
  
  test("load migrates a v0 (missing schemaVersion) file to current schema", async () => {
    const file = tempStatePath();
    const legacy = { agents: { a: fakeAgent("a") } };
    writeFileSync(file, JSON.stringify(legacy));
    const p = createPersistence({ filePath: file });
    const state = await p.load();
    assert.equal(state.schemaVersion, 1);
    assert.equal(state.agents.a?.id, "a");
    rmSync(path.dirname(file), { recursive: true });
  });
  
  test("load throws on unknown future schema version", async () => {
    const file = tempStatePath();
    writeFileSync(file, JSON.stringify({ schemaVersion: 99, agents: {} }));
    const p = createPersistence({ filePath: file });
    await assert.rejects(p.load(), /schema version/i);
    rmSync(path.dirname(file), { recursive: true });
  });
  
  function fakeAgent(id: string) {
    return {
      id,
      name: id,
      tasks: [],
      nextTaskSeq: 0,
      source: "live" as const,
      connectionStatus: "connected" as const,
      startedAt: "2026-04-15T00:00:00Z",
      lastActivityAt: "2026-04-15T00:00:00Z",
    };
  }