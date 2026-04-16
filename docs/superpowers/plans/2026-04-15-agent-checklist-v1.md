# Agent Checklist v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web app + MCP server that lets Claude Code agents publish their task checklist and real-time progress to a browser dashboard.

**Architecture:** Single Node.js process bound to `http://localhost:51723`. Fastify serves the React dashboard (built by Vite), a REST API, a WebSocket for live updates, and an MCP endpoint (Streamable HTTP). State persists to `~/.agent-checklist/state.json` with a schema version. Agents self-register using their Claude Code session UUID, captured via a `SessionStart` hook into `$CLAUDE_SESSION_ID`.

**Tech Stack:** TypeScript 6, Node ≥ 20, Fastify 5, `@fastify/websocket`, `@modelcontextprotocol/sdk` (Streamable HTTP), Zod 4, React 19, Vite 8, Tailwind 4, `node:test` + `tsx` for server tests, Vitest + React Testing Library for UI tests.

**Reference spec:** `docs/superpowers/specs/2026-04-15-agent-checklist-design.md`

---

## File Structure

```
agent-checklist/
  package.json                             # deps, scripts, bin entry
  tsconfig.json                            # server compile config
  tsconfig.web.json                        # web (react) config (vite uses its own)
  vite.config.ts                           # vite dev/build
  vitest.config.ts                         # UI test runner
  scripts/
    build.sh                               # vite build + tsc
  src/
    shared/
      types.ts                             # BoardState, Agent, Task, WsMessage, schema types
      port.ts                              # readPort() — reads AGENT_CHECKLIST_PORT or default
    server/
      persistence.ts                       # load/save state.json; debounce; migrate
      store.ts                             # pure state mutations (register/update/add/remove/...)
      broadcast.ts                         # WS client registry + broadcast()
      mcp.ts                               # MCP tool registrations
      http.ts                              # Fastify routes (health, ready, state, clear)
      ready.ts                             # readiness flag shared across modules
      signals.ts                           # SIGTERM/SIGINT graceful shutdown
      server.ts                            # compose Fastify app (imports all of the above)
      cli.ts                               # commander: start, start-background, ensure-running, status, stop
      index.ts                             # bin entry: invoke cli
    web/
      index.html                           # vite entry
      src/
        main.tsx                           # react root
        App.tsx                            # root component
        styles.css                         # tailwind entry
        hooks/
          useBoard.ts                      # WS + /api/state hydration (exists; needs update)
        components/
          Board.tsx                        # grid of AgentCards
          AgentCard.tsx                    # single agent card with task list
          TaskItem.tsx                     # one task row with status icon
          ProgressBar.tsx                  # thin progress bar
          ConnectionIndicator.tsx          # WS status dot
          ResetButton.tsx                  # reset-board button with confirm
  tests/
    server/
      persistence.test.ts
      store.test.ts
      mcp.test.ts
      http.test.ts
      cli.test.ts
    web/
      AgentCard.test.tsx
      Board.test.tsx
      useBoard.test.ts
  SKILL.md                                 # agent-facing skill shipped in the npm package
```

---

## Task 1: Update package.json, add dev/test/build dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace package.json contents**

Replace `package.json` with:

```json
{
  "name": "agent-checklist",
  "version": "0.1.0",
  "description": "Local dashboard + MCP server that shows coding agents' real-time checklists.",
  "type": "module",
  "bin": {
    "agent-checklist": "dist/server/index.js"
  },
  "files": ["dist", "SKILL.md", "README.md"],
  "scripts": {
    "dev:server": "tsx watch src/server/index.ts start",
    "dev:web": "vite",
    "build": "bash scripts/build.sh",
    "test:server": "node --import tsx --test tests/server/**/*.test.ts",
    "test:web": "vitest run",
    "test": "pnpm test:server && pnpm test:web",
    "lint:types": "tsc --noEmit"
  },
  "dependencies": {
    "@fastify/static": "^9.1.0",
    "@fastify/websocket": "^11.2.0",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "commander": "^12.1.0",
    "fastify": "^5.8.5",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.2.2",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/node": "^22.10.0",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "jsdom": "^25.0.1",
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "tailwindcss": "^4.2.2",
    "tsx": "^4.21.0",
    "typescript": "^6.0.2",
    "vite": "^8.0.8",
    "vitest": "^2.1.9"
  },
  "engines": {
    "node": ">=20.11.0"
  }
}
```

Notes:
- Dropped `dotenv` (unused).
- Added `commander` for CLI parsing, `vitest` + React Testing Library for UI tests, `jsdom` as Vitest DOM env, `@types/node` for server code.
- Scripts align to the new build + test layout.

- [ ] **Step 2: Install deps**

Run: `pnpm install`
Expected: lock file updates; no peer-dep errors.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: update package.json for v1 implementation (deps, scripts, bin)"
```

---

## Task 2: TypeScript + Vite + Vitest config

**Files:**
- Modify: `tsconfig.json`
- Create: `tsconfig.web.json`
- Modify: `vite.config.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Update `tsconfig.json` (server compile target)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/server/**/*.ts", "src/shared/**/*.ts"],
  "exclude": ["src/web/**", "tests/**", "node_modules"]
}
```

- [ ] **Step 2: Create `tsconfig.web.json` (IDE only; Vite uses its own esbuild)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/web/**/*", "src/shared/**/*", "tests/web/**/*"]
}
```

- [ ] **Step 3: Replace `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/web",
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:51723",
      "/ws": { target: "ws://localhost:51723", ws: true },
    },
  },
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/web/**/*.test.{ts,tsx}"],
    globals: true,
  },
});
```

- [ ] **Step 5: Verify types compile**

Run: `pnpm lint:types`
Expected: no errors (there is no server code yet, but the compiler must accept the config).

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json tsconfig.web.json vite.config.ts vitest.config.ts
git commit -m "chore: configure typescript + vite + vitest for dual server/web build"
```

---

## Task 3: Shared types (`src/shared/types.ts`)

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/shared/port.ts`

- [ ] **Step 1: Replace `src/shared/types.ts`**

```ts
export const SCHEMA_VERSION = 1 as const;

export type TaskStatus = "pending" | "in_progress" | "completed";
export type ConnectionStatus = "connected" | "disconnected";
export type AgentSource = "live" | "imported";

export interface Task {
  id: string;
  label: string;
  status: TaskStatus;
  note?: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  name: string;
  tasks: Task[];
  nextTaskSeq: number;
  source: AgentSource;
  connectionStatus: ConnectionStatus;
  startedAt: string;
  lastActivityAt: string;
}

export interface BoardState {
  schemaVersion: typeof SCHEMA_VERSION;
  agents: Record<string, Agent>;
}

export type WsMessage =
  | { type: "state"; payload: BoardState }
  | { type: "agent_updated"; payload: Agent }
  | { type: "task_updated"; payload: { agentId: string; task: Task } }
  | { type: "agent_removed"; payload: { agentId: string } };

export interface HealthResponse {
  service: "agent-checklist";
  version: string;
  pid: number;
  startedAt: string;
}
```

- [ ] **Step 2: Create `src/shared/port.ts`**

```ts
export const DEFAULT_PORT = 51723;

export function readPort(): number {
  const raw = process.env.AGENT_CHECKLIST_PORT;
  if (!raw) return DEFAULT_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(
      `AGENT_CHECKLIST_PORT must be an integer between 1 and 65535, got: ${raw}`,
    );
  }
  return n;
}
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm lint:types`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared
git commit -m "feat(shared): define Board/Agent/Task types with schema version + port helper"
```

---

## Task 4: Persistence layer (`src/server/persistence.ts`)

**Files:**
- Create: `src/server/persistence.ts`
- Create: `tests/server/persistence.test.ts`

- [ ] **Step 1: Write the failing test — `tests/server/persistence.test.ts`**

```ts
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
```

- [ ] **Step 2: Run — verify tests fail**

Run: `pnpm test:server`
Expected: FAIL; module not found `src/server/persistence.ts`.

- [ ] **Step 3: Implement `src/server/persistence.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION, type BoardState } from "../shared/types.js";

export interface PersistenceOptions {
  filePath: string;
  debounceMs?: number;
}

export interface Persistence {
  load(): Promise<BoardState>;
  schedule(state: BoardState): void;
  flush(): Promise<void>;
}

const EMPTY_STATE: BoardState = { schemaVersion: SCHEMA_VERSION, agents: {} };

export function createPersistence(opts: PersistenceOptions): Persistence {
  const debounceMs = opts.debounceMs ?? 200;
  let pending: BoardState | null = null;
  let timer: NodeJS.Timeout | null = null;
  let inflight: Promise<void> | null = null;

  async function writeNow(state: BoardState): Promise<void> {
    await fs.mkdir(path.dirname(opts.filePath), { recursive: true });
    const tmp = `${opts.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(tmp, opts.filePath);
  }

  async function doFlush(): Promise<void> {
    if (!pending) return;
    const toWrite = pending;
    pending = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      await writeNow(toWrite);
    } catch (err) {
      console.error("persistence: write failed; keeping in-memory state", err);
    }
  }

  return {
    async load(): Promise<BoardState> {
      let raw: string;
      try {
        raw = await fs.readFile(opts.filePath, "utf8");
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return structuredClone(EMPTY_STATE);
        }
        throw err;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`state.json is not valid JSON: ${(err as Error).message}`);
      }
      return migrate(parsed);
    },

    schedule(state: BoardState): void {
      pending = state;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        inflight = doFlush();
      }, debounceMs);
    },

    async flush(): Promise<void> {
      if (inflight) await inflight;
      await doFlush();
    },
  };
}

function migrate(input: unknown): BoardState {
  if (!input || typeof input !== "object") return structuredClone(EMPTY_STATE);
  const obj = input as { schemaVersion?: number; agents?: unknown };
  const version = obj.schemaVersion;
  if (version === undefined) {
    return {
      schemaVersion: SCHEMA_VERSION,
      agents: (obj.agents as BoardState["agents"]) ?? {},
    };
  }
  if (version === SCHEMA_VERSION) return obj as BoardState;
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schema version ${version} (this binary supports <= ${SCHEMA_VERSION}). Upgrade agent-checklist.`,
    );
  }
  throw new Error(`Unknown schema version ${version}`);
}
```

- [ ] **Step 4: Run tests — all pass**

Run: `pnpm test:server`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/persistence.ts tests/server/persistence.test.ts
git commit -m "feat(server): persistence layer with debounced writes + schema migration"
```

---

## Task 5: Store — `registerAgent` + tests

**Files:**
- Modify: `src/server/store.ts`
- Create: `tests/server/store.test.ts`

- [ ] **Step 1: Write failing tests — `tests/server/store.test.ts`**

```ts
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
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `pnpm test:server --test-name-pattern=registerAgent`
Expected: FAIL; `createStore` not exported or store module missing.

- [ ] **Step 3: Replace `src/server/store.ts` with initial implementation**

```ts
import {
  SCHEMA_VERSION,
  type Agent,
  type BoardState,
  type Task,
  type TaskStatus,
} from "../shared/types.js";

export interface RegisterAgentInput {
  agentId: string;
  name: string;
  tasks: string[];
}

export interface RegisterAgentResult {
  agent: Agent;
  taskIds: string[];
  reRegistered: boolean;
}

export interface Store {
  getState(): BoardState;
  registerAgent(input: RegisterAgentInput): RegisterAgentResult;
  markAllDisconnected(): void;
  now(): string; // exposed for tests/mocks (swapped later if needed)
}

export function createStore(initial?: BoardState): Store {
  const state: BoardState =
    initial ?? { schemaVersion: SCHEMA_VERSION, agents: {} };

  function now(): string {
    return new Date().toISOString();
  }

  function makeTask(agentId: string, seq: number, label: string, ts: string): Task {
    return {
      id: `${agentId}-t${seq}`,
      label,
      status: "pending" as TaskStatus,
      updatedAt: ts,
    };
  }

  function registerAgent(input: RegisterAgentInput): RegisterAgentResult {
    const existing = state.agents[input.agentId];
    if (existing) {
      if (existing.name !== input.name) {
        throw new Error(
          `Agent ID "${input.agentId}" already in use with a different name ("${existing.name}"). Use the existing name or choose a new ID.`,
        );
      }
      existing.connectionStatus = "connected";
      existing.lastActivityAt = now();
      return {
        agent: existing,
        taskIds: existing.tasks.map((t) => t.id),
        reRegistered: true,
      };
    }
    const ts = now();
    const tasks = input.tasks.map((label, i) => makeTask(input.agentId, i, label, ts));
    const agent: Agent = {
      id: input.agentId,
      name: input.name,
      tasks,
      nextTaskSeq: tasks.length,
      source: "live",
      connectionStatus: "connected",
      startedAt: ts,
      lastActivityAt: ts,
    };
    state.agents[input.agentId] = agent;
    return { agent, taskIds: tasks.map((t) => t.id), reRegistered: false };
  }

  function markAllDisconnected(): void {
    for (const a of Object.values(state.agents)) {
      a.connectionStatus = "disconnected";
    }
  }

  return {
    getState: () => state,
    registerAgent,
    markAllDisconnected,
    now,
  };
}
```

- [ ] **Step 4: Run tests — pass**

Run: `pnpm test:server --test-name-pattern=registerAgent`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/store.ts tests/server/store.test.ts
git commit -m "feat(server): store.registerAgent with re-register behavior"
```

---

## Task 6: Store — `updateTask` with auto-revert of concurrent in_progress

**Files:**
- Modify: `src/server/store.ts`
- Modify: `tests/server/store.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `tests/server/store.test.ts`:

```ts
test("updateTask changes status and updates timestamps", () => {
  const { agent } = store.registerAgent({ agentId: "a", name: "A", tasks: ["x"] });
  const t0 = agent.tasks[0]!;
  const before = t0.updatedAt;
  // force next ISO timestamp to be different
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
```

- [ ] **Step 2: Run — verify new tests fail**

Run: `pnpm test:server --test-name-pattern=updateTask`
Expected: FAIL.

- [ ] **Step 3: Extend `src/server/store.ts`**

Add these exports and logic to the store module. Update the `Store` interface and `createStore` return value:

```ts
// Add to top-level types
export interface UpdateTaskInput {
  agentId: string;
  taskId: string;
  status: TaskStatus;
  note?: string;
}

export interface UpdateTaskResult {
  agent: Agent;
  task: Task;
  supersededTaskIds: string[]; // other tasks auto-reverted from in_progress
}

// Extend Store interface
export interface Store {
  // ...existing...
  updateTask(input: UpdateTaskInput): UpdateTaskResult;
}
```

Inside `createStore`, add:

```ts
function updateTask(input: UpdateTaskInput): UpdateTaskResult {
  const agent = state.agents[input.agentId];
  if (!agent) throw new Error(`Agent "${input.agentId}" not found.`);
  const task = agent.tasks.find((t) => t.id === input.taskId);
  if (!task) throw new Error(`Task "${input.taskId}" not found on agent "${input.agentId}".`);

  const superseded: string[] = [];
  if (input.status === "in_progress") {
    for (const t of agent.tasks) {
      if (t.id !== task.id && t.status === "in_progress") {
        t.status = "pending";
        t.updatedAt = now();
        superseded.push(t.id);
      }
    }
  }

  task.status = input.status;
  if (Object.prototype.hasOwnProperty.call(input, "note")) {
    // caller explicitly passed note (possibly "")
    task.note = input.note === "" ? undefined : input.note;
  }
  task.updatedAt = now();
  agent.connectionStatus = "connected";
  agent.lastActivityAt = task.updatedAt;

  return { agent, task, supersededTaskIds: superseded };
}
```

Don't forget to include `updateTask` in the returned object from `createStore`.

- [ ] **Step 4: Run tests — pass**

Run: `pnpm test:server`
Expected: all previous tests still pass + 4 new ones pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/store.ts tests/server/store.test.ts
git commit -m "feat(server): store.updateTask with auto-revert of concurrent in_progress"
```

---

## Task 7: Store — add/remove/reorder/rename

**Files:**
- Modify: `src/server/store.ts`
- Modify: `tests/server/store.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
test("addTasks appends with fresh sequence IDs", () => {
  const { agent } = store.registerAgent({ agentId: "a", name: "A", tasks: ["x"] });
  const res = store.addTasks({ agentId: "a", tasks: ["y", "z"] });
  assert.deepEqual(res.taskIds, ["a-t1", "a-t2"]);
  assert.deepEqual(agent.tasks.map((t) => t.id), ["a-t0", "a-t1", "a-t2"]);
  assert.equal(agent.nextTaskSeq, 3);
});

test("addTasks afterTaskId inserts in place", () => {
  const { agent } = store.registerAgent({ agentId: "a", name: "A", tasks: ["x", "y"] });
  store.addTasks({ agentId: "a", tasks: ["mid"], afterTaskId: "a-t0" });
  assert.deepEqual(agent.tasks.map((t) => t.label), ["x", "mid", "y"]);
});

test("removeTask refuses in_progress tasks", () => {
  const { agent } = store.registerAgent({ agentId: "a", name: "A", tasks: ["x"] });
  store.updateTask({ agentId: "a", taskId: "a-t0", status: "in_progress" });
  assert.throws(() => store.removeTask({ agentId: "a", taskId: "a-t0" }), /in progress/i);
  assert.equal(agent.tasks.length, 1);
});

test("removeTask drops a pending task", () => {
  const { agent } = store.registerAgent({ agentId: "a", name: "A", tasks: ["x", "y"] });
  store.removeTask({ agentId: "a", taskId: "a-t0" });
  assert.deepEqual(agent.tasks.map((t) => t.id), ["a-t1"]);
});

test("reorderTasks validates IDs match exactly", () => {
  const { agent } = store.registerAgent({ agentId: "a", name: "A", tasks: ["x", "y", "z"] });
  store.reorderTasks({ agentId: "a", taskIds: ["a-t2", "a-t0", "a-t1"] });
  assert.deepEqual(agent.tasks.map((t) => t.id), ["a-t2", "a-t0", "a-t1"]);
  assert.throws(
    () => store.reorderTasks({ agentId: "a", taskIds: ["a-t0", "a-t1"] }),
    /exactly/i,
  );
});

test("renameTask updates label only", () => {
  const { agent } = store.registerAgent({ agentId: "a", name: "A", tasks: ["x"] });
  store.renameTask({ agentId: "a", taskId: "a-t0", label: "renamed" });
  assert.equal(agent.tasks[0]!.label, "renamed");
});

test("removeAgent removes agent and returns true, idempotent for unknown", () => {
  store.registerAgent({ agentId: "a", name: "A", tasks: [] });
  assert.equal(store.removeAgent({ agentId: "a" }), true);
  assert.equal(store.getState().agents.a, undefined);
  assert.equal(store.removeAgent({ agentId: "a" }), false);
});

test("clearAll empties the board", () => {
  store.registerAgent({ agentId: "a", name: "A", tasks: [] });
  store.registerAgent({ agentId: "b", name: "B", tasks: [] });
  store.clearAll();
  assert.deepEqual(store.getState().agents, {});
});

test("applyRestartRecovery flips connection + reverts in_progress to pending", () => {
  store.registerAgent({ agentId: "a", name: "A", tasks: ["x", "y"] });
  store.updateTask({ agentId: "a", taskId: "a-t0", status: "in_progress", note: "existing" });
  store.applyRestartRecovery();
  const s = store.getState();
  assert.equal(s.agents.a!.connectionStatus, "disconnected");
  assert.equal(s.agents.a!.tasks[0]!.status, "pending");
  assert.equal(s.agents.a!.tasks[0]!.note, "existing", "preserves existing note");
});

test("applyRestartRecovery sets note when none existed", () => {
  store.registerAgent({ agentId: "a", name: "A", tasks: ["x"] });
  store.updateTask({ agentId: "a", taskId: "a-t0", status: "in_progress" });
  store.applyRestartRecovery();
  assert.equal(store.getState().agents.a!.tasks[0]!.note, "server restarted");
});
```

- [ ] **Step 2: Run — verify they fail**

Run: `pnpm test:server`
Expected: FAIL on new test names (methods not defined).

- [ ] **Step 3: Extend `src/server/store.ts`** with the remaining primitives.

Add these interfaces and methods to `Store` and `createStore`:

```ts
export interface AddTasksInput {
  agentId: string;
  tasks: string[];
  afterTaskId?: string;
}

export interface AddTasksResult {
  agent: Agent;
  taskIds: string[];
}

export interface RemoveTaskInput { agentId: string; taskId: string; }
export interface ReorderTasksInput { agentId: string; taskIds: string[]; }
export interface RenameTaskInput { agentId: string; taskId: string; label: string; }
export interface RemoveAgentInput { agentId: string; }

// Add to Store interface
export interface Store {
  // ...existing...
  addTasks(input: AddTasksInput): AddTasksResult;
  removeTask(input: RemoveTaskInput): { agent: Agent };
  reorderTasks(input: ReorderTasksInput): { agent: Agent };
  renameTask(input: RenameTaskInput): { agent: Agent; task: Task };
  removeAgent(input: RemoveAgentInput): boolean;
  clearAll(): void;
  applyRestartRecovery(): void;
}
```

Inside `createStore`:

```ts
function requireAgent(agentId: string): Agent {
  const a = state.agents[agentId];
  if (!a) throw new Error(`Agent "${agentId}" not found.`);
  return a;
}

function addTasks(input: AddTasksInput): AddTasksResult {
  const agent = requireAgent(input.agentId);
  const ts = now();
  const created: Task[] = input.tasks.map((label) => {
    const t = makeTask(agent.id, agent.nextTaskSeq, label, ts);
    agent.nextTaskSeq += 1;
    return t;
  });
  if (input.afterTaskId) {
    const idx = agent.tasks.findIndex((t) => t.id === input.afterTaskId);
    if (idx < 0) throw new Error(`Task "${input.afterTaskId}" not found on agent "${input.agentId}".`);
    agent.tasks.splice(idx + 1, 0, ...created);
  } else {
    agent.tasks.push(...created);
  }
  agent.connectionStatus = "connected";
  agent.lastActivityAt = ts;
  return { agent, taskIds: created.map((t) => t.id) };
}

function removeTask(input: RemoveTaskInput): { agent: Agent } {
  const agent = requireAgent(input.agentId);
  const idx = agent.tasks.findIndex((t) => t.id === input.taskId);
  if (idx < 0) throw new Error(`Task "${input.taskId}" not found on agent "${input.agentId}".`);
  const task = agent.tasks[idx]!;
  if (task.status === "in_progress") {
    throw new Error(`Cannot remove a task in progress. Mark it "pending" or "completed" first.`);
  }
  agent.tasks.splice(idx, 1);
  agent.connectionStatus = "connected";
  agent.lastActivityAt = now();
  return { agent };
}

function reorderTasks(input: ReorderTasksInput): { agent: Agent } {
  const agent = requireAgent(input.agentId);
  const current = new Set(agent.tasks.map((t) => t.id));
  const next = new Set(input.taskIds);
  if (current.size !== next.size || [...current].some((id) => !next.has(id))) {
    throw new Error(
      `Reorder list must contain exactly the current task IDs (expected ${[...current].join(", ")}).`,
    );
  }
  const byId = new Map(agent.tasks.map((t) => [t.id, t] as const));
  agent.tasks = input.taskIds.map((id) => byId.get(id)!);
  agent.connectionStatus = "connected";
  agent.lastActivityAt = now();
  return { agent };
}

function renameTask(input: RenameTaskInput): { agent: Agent; task: Task } {
  const agent = requireAgent(input.agentId);
  const task = agent.tasks.find((t) => t.id === input.taskId);
  if (!task) throw new Error(`Task "${input.taskId}" not found on agent "${input.agentId}".`);
  task.label = input.label;
  task.updatedAt = now();
  agent.connectionStatus = "connected";
  agent.lastActivityAt = task.updatedAt;
  return { agent, task };
}

function removeAgent(input: RemoveAgentInput): boolean {
  if (!state.agents[input.agentId]) return false;
  delete state.agents[input.agentId];
  return true;
}

function clearAll(): void {
  state.agents = {};
}

function applyRestartRecovery(): void {
  for (const agent of Object.values(state.agents)) {
    agent.connectionStatus = "disconnected";
    for (const t of agent.tasks) {
      if (t.status === "in_progress") {
        t.status = "pending";
        if (!t.note) t.note = "server restarted";
        t.updatedAt = now();
      }
    }
  }
}
```

Remember to include all these in the returned object from `createStore`.

- [ ] **Step 4: Run tests — all pass**

Run: `pnpm test:server`
Expected: all store tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/store.ts tests/server/store.test.ts
git commit -m "feat(server): store add/remove/reorder/rename + restart recovery"
```

---

## Task 8: Broadcast + readiness flag

**Files:**
- Modify: `src/server/broadcast.ts`
- Create: `src/server/ready.ts`

- [ ] **Step 1: Replace `src/server/broadcast.ts`**

```ts
import type { WsMessage } from "../shared/types.js";

export interface WsClient {
  send(data: string): void;
}

export interface Broadcaster {
  add(client: WsClient): void;
  remove(client: WsClient): void;
  broadcast(msg: WsMessage): void;
  closeAll(): void;
  count(): number;
}

export function createBroadcaster(): Broadcaster {
  const clients = new Set<WsClient>();
  return {
    add: (c) => clients.add(c),
    remove: (c) => clients.delete(c),
    broadcast(msg) {
      const data = JSON.stringify(msg);
      for (const client of clients) {
        try {
          client.send(data);
        } catch {
          clients.delete(client);
        }
      }
    },
    closeAll() {
      for (const c of clients) {
        try {
          (c as WsClient & { close?: () => void }).close?.();
        } catch { /* ignore */ }
      }
      clients.clear();
    },
    count: () => clients.size,
  };
}
```

- [ ] **Step 2: Create `src/server/ready.ts`**

```ts
export interface ReadyFlag {
  isReady(): boolean;
  markReady(): void;
}

export function createReadyFlag(): ReadyFlag {
  let ready = false;
  return {
    isReady: () => ready,
    markReady: () => {
      ready = true;
    },
  };
}
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm lint:types`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/broadcast.ts src/server/ready.ts
git commit -m "feat(server): broadcaster module + ready flag"
```

---

## Task 9: MCP server — tool definitions + broadcasts

**Files:**
- Modify: `src/server/mcp.ts`
- Create: `tests/server/mcp.test.ts`

- [ ] **Step 1: Write failing tests — `tests/server/mcp.test.ts`**

```ts
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
```

- [ ] **Step 2: Run — verify they fail**

Run: `pnpm test:server --test-name-pattern=register_agent|update_task|remove_task|get_board`
Expected: FAIL; `createMcpToolHandlers` not exported.

- [ ] **Step 3: Replace `src/server/mcp.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Agent, Task, WsMessage } from "../shared/types.js";
import type { Store } from "./store.js";
import type { Broadcaster } from "./broadcast.js";

interface Ctx {
  store: Store;
  broadcaster: Broadcaster;
}

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}
function fail(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
function broadcastAgent(b: Broadcaster, agent: Agent) {
  const msg: WsMessage = { type: "agent_updated", payload: structuredClone(agent) };
  b.broadcast(msg);
}
function broadcastTask(b: Broadcaster, agentId: string, task: Task) {
  const msg: WsMessage = { type: "task_updated", payload: { agentId, task: structuredClone(task) } };
  b.broadcast(msg);
}

export interface McpToolHandlers {
  register_agent(input: { agentId: string; name: string; tasks: string[] }): Promise<ToolResult>;
  update_task(input: { agentId: string; taskId: string; status: "pending" | "in_progress" | "completed"; note?: string }): Promise<ToolResult>;
  add_tasks(input: { agentId: string; tasks: string[]; afterTaskId?: string }): Promise<ToolResult>;
  remove_task(input: { agentId: string; taskId: string }): Promise<ToolResult>;
  reorder_tasks(input: { agentId: string; taskIds: string[] }): Promise<ToolResult>;
  rename_task(input: { agentId: string; taskId: string; label: string }): Promise<ToolResult>;
  get_board(input: Record<string, never>): Promise<ToolResult>;
}

export function createMcpToolHandlers(ctx: Ctx): McpToolHandlers {
  return {
    async register_agent({ agentId, name, tasks }) {
      try {
        const { agent, taskIds, reRegistered } = ctx.store.registerAgent({ agentId, name, tasks });
        broadcastAgent(ctx.broadcaster, agent);
        return ok(
          reRegistered
            ? `Re-registered agent "${name}" (${taskIds.length} existing tasks).`
            : `Registered agent "${name}" with ${taskIds.length} tasks. IDs: ${taskIds.join(", ")}`,
        );
      } catch (err) {
        return fail((err as Error).message);
      }
    },

    async update_task({ agentId, taskId, status, note }) {
      try {
        const { task, supersededTaskIds, agent } = ctx.store.updateTask({ agentId, taskId, status, note });
        broadcastTask(ctx.broadcaster, agentId, task);
        for (const id of supersededTaskIds) {
          const superseded = agent.tasks.find((t) => t.id === id)!;
          broadcastTask(ctx.broadcaster, agentId, superseded);
        }
        return ok(`Task "${task.label}" → ${task.status}`);
      } catch (err) {
        return fail((err as Error).message);
      }
    },

    async add_tasks({ agentId, tasks, afterTaskId }) {
      try {
        const { agent, taskIds } = ctx.store.addTasks({ agentId, tasks, afterTaskId });
        broadcastAgent(ctx.broadcaster, agent);
        return ok(`Added ${taskIds.length} task(s). IDs: ${taskIds.join(", ")}`);
      } catch (err) {
        return fail((err as Error).message);
      }
    },

    async remove_task({ agentId, taskId }) {
      try {
        const { agent } = ctx.store.removeTask({ agentId, taskId });
        broadcastAgent(ctx.broadcaster, agent);
        return ok(`Removed task "${taskId}".`);
      } catch (err) {
        return fail((err as Error).message);
      }
    },

    async reorder_tasks({ agentId, taskIds }) {
      try {
        const { agent } = ctx.store.reorderTasks({ agentId, taskIds });
        broadcastAgent(ctx.broadcaster, agent);
        return ok(`Reordered ${taskIds.length} task(s).`);
      } catch (err) {
        return fail((err as Error).message);
      }
    },

    async rename_task({ agentId, taskId, label }) {
      try {
        const { agent, task } = ctx.store.renameTask({ agentId, taskId, label });
        broadcastTask(ctx.broadcaster, agentId, task);
        // Also send agent_updated so progress-counter derived data re-renders elsewhere if needed.
        broadcastAgent(ctx.broadcaster, agent);
        return ok(`Renamed task to "${label}".`);
      } catch (err) {
        return fail((err as Error).message);
      }
    },

    async get_board() {
      return ok(JSON.stringify(ctx.store.getState(), null, 2));
    },
  };
}

export function createMcpServer(ctx: Ctx): McpServer {
  const mcp = new McpServer(
    { name: "agent-checklist", version: "0.1.0" },
    { instructions: "Publish the calling agent's task checklist and real-time progress to the local dashboard." },
  );
  const h = createMcpToolHandlers(ctx);

  mcp.tool(
    "register_agent",
    "Register the calling agent with its planned task checklist. Use $CLAUDE_SESSION_ID as agentId when available. Safe to call again with the same agentId and name (re-registers without duplicating tasks).",
    {
      agentId: z.string().min(1).describe("Unique ID for this agent — use $CLAUDE_SESSION_ID when possible."),
      name: z.string().min(1).describe("Human-readable title shown on the dashboard card."),
      tasks: z.array(z.string().min(1)).describe("Ordered list of task descriptions."),
    },
    h.register_agent,
  );

  mcp.tool(
    "update_task",
    "Set a task's status. Setting one task to in_progress auto-reverts any other in_progress task on the same agent to pending.",
    {
      agentId: z.string().min(1),
      taskId: z.string().min(1),
      status: z.enum(["pending", "in_progress", "completed"]),
      note: z.string().optional().describe("Optional context shown next to the task. Omit to preserve, empty string to clear."),
    },
    h.update_task,
  );

  mcp.tool(
    "add_tasks",
    "Append new tasks to an existing agent. Provide afterTaskId to insert in-place instead of appending.",
    {
      agentId: z.string().min(1),
      tasks: z.array(z.string().min(1)),
      afterTaskId: z.string().min(1).optional(),
    },
    h.add_tasks,
  );

  mcp.tool(
    "remove_task",
    "Remove a task. Refuses tasks that are in_progress; set them to pending or completed first.",
    { agentId: z.string().min(1), taskId: z.string().min(1) },
    h.remove_task,
  );

  mcp.tool(
    "reorder_tasks",
    "Replace the ordered task list. taskIds must contain exactly the agent's current task IDs.",
    { agentId: z.string().min(1), taskIds: z.array(z.string().min(1)) },
    h.reorder_tasks,
  );

  mcp.tool(
    "rename_task",
    "Update a task's label. Status and other fields are unchanged.",
    { agentId: z.string().min(1), taskId: z.string().min(1), label: z.string().min(1) },
    h.rename_task,
  );

  mcp.tool(
    "get_board",
    "Return the full current board state (all agents and tasks).",
    {},
    h.get_board,
  );

  return mcp;
}
```

- [ ] **Step 4: Run tests — pass**

Run: `pnpm test:server`
Expected: all tests pass including new MCP tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/mcp.ts tests/server/mcp.test.ts
git commit -m "feat(server): MCP tools — register/update/add/remove/reorder/rename/get_board"
```

---

## Task 10: HTTP routes — health, ready, state, clear

**Files:**
- Create: `src/server/http.ts`
- Create: `tests/server/http.test.ts`

- [ ] **Step 1: Write failing tests — `tests/server/http.test.ts`**

```ts
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
    store, broadcaster, ready, version: "0.1.0-test", startedAt,
  });
  await app.ready();
});

afterEach(async () => { await app.close(); });

test("GET /api/health returns service metadata immediately", async () => {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.service, "agent-checklist");
  assert.equal(body.version, "0.1.0-test");
  assert.equal(body.pid, process.pid);
  assert.equal(body.startedAt, startedAt);
});

test("GET /api/ready returns 503 before markReady, 200 after", async () => {
  const before = await app.inject({ method: "GET", url: "/api/ready" });
  assert.equal(before.statusCode, 503);
  // flip ready by peeking at the app.decorator; simpler: rebuild
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
```

- [ ] **Step 2: Run — verify failures**

Run: `pnpm test:server --test-name-pattern=GET|POST`
Expected: FAIL; `registerHttpRoutes` not defined.

- [ ] **Step 3: Implement `src/server/http.ts`**

```ts
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
```

- [ ] **Step 4: Run tests — pass**

Run: `pnpm test:server`
Expected: all HTTP tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/http.ts tests/server/http.test.ts
git commit -m "feat(server): HTTP routes — /api/health, /api/ready, /api/state, clear"
```

---

## Task 11: Compose the Fastify server (WebSocket + MCP + static + routes)

**Files:**
- Create: `src/server/server.ts`

- [ ] **Step 1: Create `src/server/server.ts`**

```ts
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createStore, type Store } from "./store.js";
import { createBroadcaster, type Broadcaster } from "./broadcast.js";
import { createPersistence, type Persistence } from "./persistence.js";
import { createReadyFlag, type ReadyFlag } from "./ready.js";
import { registerHttpRoutes } from "./http.js";
import { createMcpServer } from "./mcp.js";
import type { WsMessage } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = process.env.AGENT_CHECKLIST_STATE_FILE
  ?? path.join(process.env.HOME ?? "", ".agent-checklist", "state.json");

export interface ServerHandle {
  app: FastifyInstance;
  store: Store;
  broadcaster: Broadcaster;
  persistence: Persistence;
  ready: ReadyFlag;
  port: number;
  startedAt: string;
}

export interface StartOpts {
  port: number;
  stateFilePath?: string;
  version: string;
}

export async function startServer(opts: StartOpts): Promise<ServerHandle> {
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
        send: (data: string) => socket.send(data),
        close: () => socket.close(),
      };
      broadcaster.add(client);
      const initial: WsMessage = { type: "state", payload: store.getState() };
      socket.send(JSON.stringify(initial));
      socket.on("close", () => broadcaster.remove(client));
    });
  });

  // MCP (Streamable HTTP, stateless — one transport per request)
  const mcp = createMcpServer({ store, broadcaster });
  app.all("/mcp", async (req, reply) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    await mcp.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  // Persist on every mutation: subscribe to the broadcaster
  const saver = {
    send: (_data: string) => { persistence.schedule(store.getState()); },
    close: () => {},
  };
  broadcaster.add(saver);

  await app.listen({ port: opts.port, host: "127.0.0.1" });
  ready.markReady();

  return { app, store, broadcaster, persistence, ready, port: opts.port, startedAt };
}
```

- [ ] **Step 2: Compile**

Run: `pnpm lint:types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/server.ts
git commit -m "feat(server): compose Fastify app (static, REST, WS, MCP, persistence hook)"
```

---

## Task 12: Graceful shutdown

**Files:**
- Create: `src/server/signals.ts`

- [ ] **Step 1: Create `src/server/signals.ts`**

```ts
import type { ServerHandle } from "./server.js";

export function installShutdownHandlers(handle: ServerHandle): () => Promise<void> {
  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    handle.app.log.info?.(`received ${signal}; shutting down`);
    try {
      await handle.persistence.flush();
    } catch (err) {
      console.error("flush during shutdown failed", err);
    }
    handle.broadcaster.closeAll();
    try { await handle.app.close(); } catch { /* ignore */ }
    process.exit(0);
  }
  const sigterm = () => void shutdown("SIGTERM");
  const sigint = () => void shutdown("SIGINT");
  process.on("SIGTERM", sigterm);
  process.on("SIGINT", sigint);
  return async () => {
    process.off("SIGTERM", sigterm);
    process.off("SIGINT", sigint);
  };
}
```

- [ ] **Step 2: Compile**

Run: `pnpm lint:types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/signals.ts
git commit -m "feat(server): graceful shutdown on SIGTERM/SIGINT with persistence flush"
```

---

## Task 13: CLI — `start` subcommand (foreground)

**Files:**
- Create: `src/server/cli.ts`
- Create: `src/server/index.ts`

- [ ] **Step 1: Create `src/server/cli.ts` (partial — foreground start only; other subcommands added in later tasks)**

```ts
import { Command } from "commander";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPort } from "../shared/port.js";
import { startServer } from "./server.js";
import { installShutdownHandlers } from "./signals.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  // The CLI lives at dist/server/cli.js at runtime; package.json is two dirs up.
  const pkgPath = path.resolve(__dirname, "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

export function buildCli(): Command {
  const program = new Command();
  program
    .name("agent-checklist")
    .description("Local MCP server + dashboard for coding-agent checklists.")
    .version(readVersion());

  program
    .command("start")
    .description("Start the server in the foreground (Ctrl+C to stop).")
    .action(async () => {
      const port = readPort();
      const handle = await startServer({ port, version: readVersion() });
      installShutdownHandlers(handle);
      console.log(`agent-checklist listening on http://localhost:${port}`);
      console.log(`  dashboard: http://localhost:${port}/`);
      console.log(`  MCP:       http://localhost:${port}/mcp`);
    });

  return program;
}

export async function runCli(argv: readonly string[]): Promise<void> {
  await buildCli().parseAsync(argv as string[]);
}
```

- [ ] **Step 2: Create `src/server/index.ts` (bin entry)**

```ts
#!/usr/bin/env node
import { runCli } from "./cli.js";

runCli(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 3: Smoke-test start via tsx**

Run:
```bash
AGENT_CHECKLIST_STATE_FILE=/tmp/agent-checklist-smoke.json \
  pnpm exec tsx src/server/index.ts start &
sleep 1
curl -s http://localhost:51723/api/health
kill %1
```
Expected: JSON like `{"service":"agent-checklist","version":"0.1.0","pid":…,"startedAt":…}`.

- [ ] **Step 4: Commit**

```bash
git add src/server/cli.ts src/server/index.ts
git commit -m "feat(cli): agent-checklist start (foreground)"
```

---

## Task 14: CLI — `start-background`, `ensure-running`, `status`, `stop`

**Files:**
- Modify: `src/server/cli.ts`
- Create: `tests/server/cli.test.ts`

- [ ] **Step 1: Write failing tests — `tests/server/cli.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function runCli(
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn("node", ["--import", "tsx", "src/server/index.ts", ...args], {
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 10_000);
  return once(child, "exit").then(([code]) => {
    clearTimeout(timer);
    return { code: (code as number) ?? -1, stdout, stderr };
  });
}

async function waitForHealth(port: number, timeoutMs = 5000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://localhost:${port}/api/health`);
      if (r.ok) {
        const body = await r.json() as { service?: string };
        if (body.service === "agent-checklist") return true;
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test("start-background spawns a server, status reports healthy, stop shuts it down", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ac-cli-"));
  const stateFile = path.join(dir, "state.json");
  const port = 51800 + Math.floor(Math.random() * 100);
  const env = {
    AGENT_CHECKLIST_PORT: String(port),
    AGENT_CHECKLIST_STATE_FILE: stateFile,
  };

  const startRes = await runCli(["start-background"], { env, timeoutMs: 10_000 });
  assert.equal(startRes.code, 0, startRes.stderr);
  assert.equal(await waitForHealth(port), true);

  const status = await runCli(["status"], { env });
  assert.equal(status.code, 0);
  assert.match(status.stdout, /agent-checklist/);

  const stop = await runCli(["stop"], { env });
  assert.equal(stop.code, 0);

  rmSync(dir, { recursive: true });
});

test("ensure-running on a live server is a no-op exit 0", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ac-cli-"));
  const stateFile = path.join(dir, "state.json");
  const port = 51900 + Math.floor(Math.random() * 50);
  const env = {
    AGENT_CHECKLIST_PORT: String(port),
    AGENT_CHECKLIST_STATE_FILE: stateFile,
  };

  assert.equal((await runCli(["start-background"], { env })).code, 0);
  assert.equal(await waitForHealth(port), true);
  const res = await runCli(["ensure-running"], { env });
  assert.equal(res.code, 0);
  await runCli(["stop"], { env });
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run — tests should fail**

Run: `pnpm test:server --test-name-pattern=start-background|ensure-running`
Expected: FAIL; subcommands not implemented.

- [ ] **Step 3: Extend `src/server/cli.ts`**

Add these imports/helpers at the top of the file:

```ts
import { spawn } from "node:child_process";
import type { HealthResponse } from "../shared/types.js";
```

Add these helpers above `buildCli`:

```ts
async function probeHealth(port: number, timeoutMs = 2000): Promise<HealthResponse | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`http://localhost:${port}/api/health`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const body = (await r.json()) as HealthResponse;
    return body.service === "agent-checklist" ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function probeReady(port: number, timeoutMs = 1500): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`http://localhost:${port}/api/ready`, { signal: ctrl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function waitForReady(port: number, overallMs = 5000): Promise<boolean> {
  const until = Date.now() + overallMs;
  while (Date.now() < until) {
    if (await probeReady(port, 500)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function spawnDetached(): Promise<void> {
  const entry = path.resolve(__dirname, "./index.js"); // points to compiled CLI at runtime
  // In dev (tsx), fall back to running this file under tsx so tests don't require a build.
  const isCompiled = entry.endsWith(".js");
  const command = isCompiled ? process.execPath : process.execPath;
  const args = isCompiled
    ? [entry, "start"]
    : ["--import", "tsx", path.resolve(__dirname, "./index.ts"), "start"];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}
```

Then register the subcommands inside `buildCli` (add to the existing function):

```ts
  program
    .command("start-background")
    .description("Fork the server into the background; poll /api/ready before exiting.")
    .action(async () => {
      const port = readPort();
      // If already up, just exit 0.
      if (await probeHealth(port)) {
        console.log(`already running on :${port}`);
        process.exit(0);
      }
      await spawnDetached();
      if (!(await waitForReady(port))) {
        console.error(`agent-checklist did not become ready on :${port} within 5s`);
        process.exit(1);
      }
      console.log(`agent-checklist ready on :${port}`);
      process.exit(0);
    });

  program
    .command("ensure-running")
    .description("Probe /api/health; if not alive, start-background. Idempotent.")
    .action(async () => {
      const port = readPort();
      const backoffs = [200, 500, 1000];
      for (let attempt = 0; attempt <= backoffs.length; attempt++) {
        const h = await probeHealth(port);
        if (h) { process.exit(0); }
        if (attempt === 0) {
          await spawnDetached();
        }
        if (attempt < backoffs.length) {
          await new Promise((r) => setTimeout(r, backoffs[attempt]!));
        }
      }
      console.error(`agent-checklist could not be reached or started on :${port}`);
      process.exit(1);
    });

  program
    .command("status")
    .description("Probe /api/health and print the result.")
    .action(async () => {
      const port = readPort();
      const h = await probeHealth(port);
      if (!h) {
        console.log(`not running on :${port}`);
        process.exit(1);
      }
      console.log(`agent-checklist v${h.version} running on :${port} (pid ${h.pid}, started ${h.startedAt})`);
      process.exit(0);
    });

  program
    .command("stop")
    .description("Send SIGTERM to the running server.")
    .action(async () => {
      const port = readPort();
      const h = await probeHealth(port);
      if (!h) {
        console.error(`not running on :${port}`);
        process.exit(1);
      }
      try {
        process.kill(h.pid, "SIGTERM");
      } catch (err) {
        console.error(`failed to signal pid ${h.pid}: ${(err as Error).message}`);
        process.exit(1);
      }
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        if (!(await probeHealth(port, 500))) {
          console.log(`stopped (was pid ${h.pid})`);
          process.exit(0);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      console.error(`pid ${h.pid} did not exit within 5s; you may need to kill -9`);
      process.exit(1);
    });
```

- [ ] **Step 4: Run tests — they pass**

Run: `pnpm test:server`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/cli.ts tests/server/cli.test.ts
git commit -m "feat(cli): start-background, ensure-running, status, stop"
```

---

## Task 15: Tailwind setup + React entry

**Files:**
- Create: `src/web/index.html`
- Create: `src/web/src/main.tsx`
- Create: `src/web/src/styles.css`
- Create: `src/web/src/App.tsx` (stub)

- [x] **Step 1: Create `src/web/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent Checklist</title>
  </head>
  <body class="bg-neutral-50 text-neutral-900">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [x] **Step 2: Create `src/web/src/styles.css`**

```css
@import "tailwindcss";

html, body, #root {
  height: 100%;
}
body {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
```

- [x] **Step 3: Create `src/web/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [x] **Step 4: Create stub `src/web/src/App.tsx`**

```tsx
export default function App() {
  return <div className="p-8 text-xl">Agent Checklist dashboard</div>;
}
```

- [x] **Step 5: Smoke-test dev server**

Run: `pnpm dev:web`
Open: `http://localhost:5173`
Expected: page shows "Agent Checklist dashboard".
Stop with Ctrl+C.

- [x] **Step 6: Commit**

```bash
git add src/web/index.html src/web/src
git commit -m "feat(web): Vite + Tailwind entry with placeholder App"
```

---

## Task 16: `useBoard` hook — rewrite against new types

**Files:**
- Modify: `src/web/src/hooks/useBoard.ts`
- Create: `tests/web/useBoard.test.ts`

- [x] **Step 1: Replace `src/web/src/hooks/useBoard.ts`**

```ts
import { useEffect, useRef, useState } from "react";
import type { BoardState, WsMessage, Agent, Task } from "@shared/types";

export interface UseBoardResult {
  board: BoardState;
  connected: boolean;
}

const EMPTY_BOARD: BoardState = { schemaVersion: 1, agents: {} };

export function useBoard(): UseBoardResult {
  const [board, setBoard] = useState<BoardState>(EMPTY_BOARD);
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const r = await fetch("/api/state");
        if (r.ok && !cancelled) {
          const s = (await r.json()) as BoardState;
          setBoard(s);
        }
      } catch { /* will retry via WS fallback */ }
    }

    function applyMessage(msg: WsMessage) {
      setBoard((prev) => {
        if (msg.type === "state") return msg.payload;
        if (msg.type === "agent_updated") {
          return { ...prev, agents: { ...prev.agents, [msg.payload.id]: msg.payload } };
        }
        if (msg.type === "agent_removed") {
          const { [msg.payload.agentId]: _, ...rest } = prev.agents;
          return { ...prev, agents: rest };
        }
        if (msg.type === "task_updated") {
          const agent = prev.agents[msg.payload.agentId];
          if (!agent) return prev;
          const tasks: Task[] = agent.tasks.map((t) =>
            t.id === msg.payload.task.id ? msg.payload.task : t,
          );
          const nextAgent: Agent = { ...agent, tasks, lastActivityAt: msg.payload.task.updatedAt, connectionStatus: "connected" };
          return { ...prev, agents: { ...prev.agents, [msg.payload.agentId]: nextAgent } };
        }
        return prev;
      });
    }

    function connect() {
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setConnected(true);
        // Refresh from REST on every (re)connect to avoid drift from missed messages.
        void hydrate();
      };
      ws.onclose = () => {
        setConnected(false);
        reconnectTimer.current = setTimeout(connect, 1000);
      };
      ws.onmessage = (e) => {
        try {
          applyMessage(JSON.parse(String(e.data)) as WsMessage);
        } catch {
          /* drop malformed */
        }
      };
      return () => ws.close();
    }

    const dispose = connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      dispose?.();
    };
  }, []);

  return { board, connected };
}
```

- [x] **Step 2: Write `tests/web/useBoard.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBoard } from "../../src/web/src/hooks/useBoard";

type Handler = (ev: MessageEvent) => void;

class MockWs {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: Handler | null = null;
  close = vi.fn();
  constructor() { MockWs.instances.push(this); }
  static instances: MockWs[] = [];
  fireOpen() { this.onopen?.(); }
  fireMessage(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
}

beforeEach(() => {
  MockWs.instances = [];
  (globalThis as any).WebSocket = MockWs;
  (globalThis as any).fetch = vi.fn(async () =>
    new Response(JSON.stringify({ schemaVersion: 1, agents: {} }), { status: 200 }),
  );
});

describe("useBoard", () => {
  it("hydrates from /api/state and handles state message", async () => {
    const { result } = renderHook(() => useBoard());
    const ws = MockWs.instances[0]!;
    act(() => ws.fireOpen());
    await waitFor(() => expect(result.current.connected).toBe(true));
    act(() =>
      ws.fireMessage({
        type: "state",
        payload: {
          schemaVersion: 1,
          agents: {
            a: { id: "a", name: "A", tasks: [], nextTaskSeq: 0, source: "live", connectionStatus: "connected", startedAt: "x", lastActivityAt: "x" },
          },
        },
      }),
    );
    await waitFor(() => expect(result.current.board.agents.a?.name).toBe("A"));
  });

  it("agent_removed drops the agent", async () => {
    const { result } = renderHook(() => useBoard());
    const ws = MockWs.instances[0]!;
    act(() => ws.fireOpen());
    act(() =>
      ws.fireMessage({
        type: "state",
        payload: {
          schemaVersion: 1,
          agents: {
            a: { id: "a", name: "A", tasks: [], nextTaskSeq: 0, source: "live", connectionStatus: "connected", startedAt: "x", lastActivityAt: "x" },
          },
        },
      }),
    );
    act(() => ws.fireMessage({ type: "agent_removed", payload: { agentId: "a" } }));
    await waitFor(() => expect(result.current.board.agents.a).toBeUndefined());
  });
});
```

- [x] **Step 3: Run UI tests**

Run: `pnpm test:web`
Expected: both tests pass.

- [x] **Step 4: Commit**

```bash
git add src/web/src/hooks/useBoard.ts tests/web/useBoard.test.ts
git commit -m "feat(web): useBoard hook — WS + /api/state hydration with reconnect"
```

---

## Task 17: `TaskItem`, `ProgressBar`, `AgentCard`

**Files:**
- Create: `src/web/src/components/TaskItem.tsx`
- Create: `src/web/src/components/ProgressBar.tsx`
- Create: `src/web/src/components/AgentCard.tsx`
- Create: `tests/web/AgentCard.test.tsx`

- [ ] **Step 1: Create `src/web/src/components/TaskItem.tsx`**

```tsx
import type { Task } from "@shared/types";

const statusIcon: Record<Task["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
};

const statusColor: Record<Task["status"], string> = {
  pending: "text-neutral-400",
  in_progress: "text-blue-600",
  completed: "text-green-600",
};

export interface TaskItemProps {
  task: Task;
}

export function TaskItem({ task }: TaskItemProps) {
  return (
    <div className="flex items-start gap-2 py-1 text-sm" data-testid={`task-${task.id}`}>
      <span className={`shrink-0 font-bold ${statusColor[task.status]}`} aria-label={task.status}>
        {statusIcon[task.status]}
      </span>
      <div className="min-w-0 flex-1">
        <div className={task.status === "completed" ? "line-through text-neutral-500" : ""}>
          {task.label}
        </div>
        {task.note && <div className="text-xs text-neutral-500 italic">{task.note}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/web/src/components/ProgressBar.tsx`**

```tsx
export interface ProgressBarProps {
  done: number;
  total: number;
}

export function ProgressBar({ done, total }: ProgressBarProps) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="h-1.5 w-full rounded bg-neutral-200 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-green-500 transition-[width] duration-200" style={{ width: `${pct}%` }} />
    </div>
  );
}
```

- [ ] **Step 3: Create `src/web/src/components/AgentCard.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { Agent } from "@shared/types";
import { TaskItem } from "./TaskItem";
import { ProgressBar } from "./ProgressBar";

export interface AgentCardProps {
  agent: Agent;
  onClear: (agentId: string) => void;
}

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function AgentCard({ agent, onClear }: AgentCardProps) {
  const completed = agent.tasks.filter((t) => t.status === "completed");
  const active = agent.tasks.filter((t) => t.status !== "completed");
  const [showCompleted, setShowCompleted] = useState(completed.length <= 5);
  const listRef = useRef<HTMLDivElement>(null);
  const inProgressId = useMemo(
    () => agent.tasks.find((t) => t.status === "in_progress")?.id,
    [agent.tasks],
  );

  useEffect(() => {
    if (!inProgressId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-testid="task-${inProgressId}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [inProgressId]);

  const IDLE_MS = 10 * 60 * 1000;
  const isDisconnected = agent.connectionStatus === "disconnected";
  const isIdle =
    !isDisconnected && Date.now() - new Date(agent.lastActivityAt).getTime() > IDLE_MS;
  const isDim = isDisconnected || isIdle;

  const subtitle = isDisconnected
    ? `offline · last seen ${timeSince(agent.lastActivityAt)}`
    : isIdle
    ? `idle · last seen ${timeSince(agent.lastActivityAt)}`
    : timeSince(agent.lastActivityAt);

  return (
    <article
      className={`flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm ${isDim ? "opacity-60" : ""}`}
      data-testid={`agent-${agent.id}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{agent.name}</h2>
          <div className="text-xs text-neutral-500">
            {completed.length} of {agent.tasks.length} done · {subtitle}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onClear(agent.id)}
          className="text-xs text-neutral-500 hover:text-red-600"
          aria-label={`Clear agent ${agent.name}`}
        >
          Clear
        </button>
      </header>

      <ProgressBar done={completed.length} total={agent.tasks.length} />

      <div ref={listRef} className="max-h-[380px] overflow-y-auto">
        {active.map((t) => <TaskItem key={t.id} task={t} />)}
        {completed.length > 0 && (
          <button
            type="button"
            className="mt-2 text-xs text-neutral-500 hover:text-neutral-800"
            onClick={() => setShowCompleted((v) => !v)}
          >
            {showCompleted ? "▾" : "▸"} {completed.length} completed
          </button>
        )}
        {showCompleted && completed.map((t) => <TaskItem key={t.id} task={t} />)}
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Write `tests/web/AgentCard.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentCard } from "../../src/web/src/components/AgentCard";
import type { Agent } from "../../src/shared/types";

function make(agent: Partial<Agent>): Agent {
  return {
    id: "a",
    name: "Login",
    tasks: [],
    nextTaskSeq: 0,
    source: "live",
    connectionStatus: "connected",
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    ...agent,
  };
}

describe("AgentCard", () => {
  it("shows progress counts and renders tasks", () => {
    const agent = make({
      tasks: [
        { id: "a-t0", label: "A", status: "completed", updatedAt: "x" },
        { id: "a-t1", label: "B", status: "in_progress", updatedAt: "x" },
        { id: "a-t2", label: "C", status: "pending", updatedAt: "x" },
      ],
    });
    render(<AgentCard agent={agent} onClear={() => {}} />);
    expect(screen.getByText(/1 of 3 done/)).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
    expect(screen.getByText("C")).toBeTruthy();
  });

  it("hides completed by default when there are more than 5", () => {
    const tasks = Array.from({ length: 7 }, (_, i) => ({
      id: `a-t${i}`, label: `Done${i}`, status: "completed" as const, updatedAt: "x",
    }));
    render(<AgentCard agent={make({ tasks })} onClear={() => {}} />);
    expect(screen.queryByText("Done0")).toBeNull();
    fireEvent.click(screen.getByText(/7 completed/));
    expect(screen.getByText("Done0")).toBeTruthy();
  });

  it("calls onClear when clear button pressed", () => {
    const onClear = vi.fn();
    render(<AgentCard agent={make({})} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: /clear agent login/i }));
    expect(onClear).toHaveBeenCalledWith("a");
  });

  it("dims disconnected agents", () => {
    const { container } = render(
      <AgentCard agent={make({ connectionStatus: "disconnected" })} onClear={() => {}} />,
    );
    expect(container.querySelector("[data-testid='agent-a']")?.className).toMatch(/opacity-60/);
  });
});
```

- [ ] **Step 5: Run tests — pass**

Run: `pnpm test:web`
Expected: all AgentCard tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/web/src/components tests/web/AgentCard.test.tsx
git commit -m "feat(web): AgentCard, TaskItem, ProgressBar components"
```

---

## Task 18: `Board`, `ConnectionIndicator`, `ResetButton`, wire up `App`

**Files:**
- Create: `src/web/src/components/Board.tsx`
- Create: `src/web/src/components/ConnectionIndicator.tsx`
- Create: `src/web/src/components/ResetButton.tsx`
- Modify: `src/web/src/App.tsx`
- Create: `tests/web/Board.test.tsx`

- [ ] **Step 1: Create `src/web/src/components/ConnectionIndicator.tsx`**

```tsx
export interface ConnectionIndicatorProps {
  connected: boolean;
}

export function ConnectionIndicator({ connected }: ConnectionIndicatorProps) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-neutral-500" aria-live="polite">
      <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} aria-hidden />
      {connected ? "connected" : "reconnecting…"}
    </span>
  );
}
```

- [ ] **Step 2: Create `src/web/src/components/ResetButton.tsx`**

```tsx
import { useState } from "react";

export function ResetButton() {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (!window.confirm("Clear every agent from the board?")) return;
    setBusy(true);
    try {
      await fetch("/api/board/clear", { method: "POST" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
    >
      {busy ? "…" : "Reset board"}
    </button>
  );
}
```

- [ ] **Step 3: Create `src/web/src/components/Board.tsx`**

```tsx
import type { BoardState } from "@shared/types";
import { AgentCard } from "./AgentCard";

export interface BoardProps {
  state: BoardState;
}

export function Board({ state }: BoardProps) {
  const agents = Object.values(state.agents).sort(
    (a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt),
  );

  async function onClear(agentId: string) {
    if (!window.confirm(`Remove agent "${state.agents[agentId]?.name ?? agentId}" from the board?`)) return;
    await fetch(`/api/agents/${encodeURIComponent(agentId)}/clear`, { method: "POST" });
  }

  if (agents.length === 0) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-neutral-500">
        No agents yet. Register one via the MCP tool to see it appear here.
      </div>
    );
  }

  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", alignItems: "start" }}
    >
      {agents.map((a) => <AgentCard key={a.id} agent={a} onClear={onClear} />)}
    </div>
  );
}
```

- [ ] **Step 4: Replace `src/web/src/App.tsx`**

```tsx
import { useBoard } from "./hooks/useBoard";
import { Board } from "./components/Board";
import { ConnectionIndicator } from "./components/ConnectionIndicator";
import { ResetButton } from "./components/ResetButton";

export default function App() {
  const { board, connected } = useBoard();
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Agent Checklist</h1>
          <p className="text-sm text-neutral-500">Live view of every running coding agent.</p>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionIndicator connected={connected} />
          <ResetButton />
        </div>
      </header>
      <Board state={board} />
    </div>
  );
}
```

- [ ] **Step 5: Write `tests/web/Board.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Board } from "../../src/web/src/components/Board";
import type { BoardState } from "../../src/shared/types";

describe("Board", () => {
  it("renders empty state when there are no agents", () => {
    const state: BoardState = { schemaVersion: 1, agents: {} };
    render(<Board state={state} />);
    expect(screen.getByText(/no agents yet/i)).toBeTruthy();
  });

  it("renders one card per agent sorted by lastActivityAt desc", () => {
    const state: BoardState = {
      schemaVersion: 1,
      agents: {
        old: {
          id: "old", name: "Old", tasks: [], nextTaskSeq: 0, source: "live", connectionStatus: "connected",
          startedAt: "2026-04-15T00:00:00Z", lastActivityAt: "2026-04-15T00:00:00Z",
        },
        new: {
          id: "new", name: "New", tasks: [], nextTaskSeq: 0, source: "live", connectionStatus: "connected",
          startedAt: "2026-04-15T01:00:00Z", lastActivityAt: "2026-04-15T01:00:00Z",
        },
      },
    };
    const { container } = render(<Board state={state} />);
    const names = Array.from(container.querySelectorAll("article h2")).map((n) => n.textContent);
    expect(names).toEqual(["New", "Old"]);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `pnpm test:web`
Expected: all tests pass.

- [ ] **Step 7: Smoke-test the combined dev environment**

Open two terminals:

Terminal 1: `AGENT_CHECKLIST_STATE_FILE=/tmp/ac.json pnpm dev:server`
Terminal 2: `pnpm dev:web`

Open http://localhost:5173. Use `curl` to register an agent:
```bash
curl -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"register_agent","arguments":{"agentId":"smoke-1","name":"Smoke test","tasks":["First","Second","Third"]}}}' \
  http://localhost:51723/mcp
```
Expected: card appears in the browser immediately.

Stop both processes.

- [ ] **Step 8: Commit**

```bash
git add src/web/src/components src/web/src/App.tsx tests/web/Board.test.tsx
git commit -m "feat(web): Board + ConnectionIndicator + ResetButton wired to useBoard"
```

---

## Task 19: MCP integration test (end-to-end over Streamable HTTP)

**Files:**
- Modify: `tests/server/mcp.test.ts` (append a live-server integration suite)

- [ ] **Step 1: Append to `tests/server/mcp.test.ts`**

```ts
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
    assert.ok(reg.result);
    assert.equal(handle.store.getState().agents["sess-x"]?.tasks.length, 2);

    const upd = await callMcp(port, "tools/call", {
      name: "update_task",
      arguments: { agentId: "sess-x", taskId: "sess-x-t0", status: "in_progress" },
    });
    assert.ok(upd.result);
    assert.equal(handle.store.getState().agents["sess-x"]!.tasks[0]!.status, "in_progress");
  } finally {
    await handle.app.close();
    rmSync(dir, { recursive: true });
  }
});
```

- [ ] **Step 2: Run — pass**

Run: `pnpm test:server --test-name-pattern=integration`
Expected: the integration test passes.

- [ ] **Step 3: Commit**

```bash
git add tests/server/mcp.test.ts
git commit -m "test(server): end-to-end MCP integration (initialize + register + update)"
```

---

## Task 20: Build script + static-asset path resolution

**Files:**
- Create: `scripts/build.sh`

- [ ] **Step 1: Create `scripts/build.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
rm -rf dist
pnpm exec vite build
pnpm exec tsc -p tsconfig.json
chmod +x dist/server/index.js || true
echo "build complete: dist/"
```

- [ ] **Step 2: Make executable**

Run: `chmod +x scripts/build.sh`

- [ ] **Step 3: Run the build**

Run: `pnpm build`
Expected:
- `dist/web/index.html` + hashed JS/CSS exist.
- `dist/server/index.js`, `dist/server/server.js`, etc. exist.
- `dist/server/index.js` has a shebang (from source) and is executable.

Run (smoke): `node dist/server/index.js --version`
Expected: prints `0.1.0`.

Run (serve):
```bash
AGENT_CHECKLIST_STATE_FILE=/tmp/ac-build.json \
  node dist/server/index.js start &
sleep 1
curl -s http://localhost:51723/api/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:51723/
kill %1
```
Expected: `200` for the dashboard HTML; health returns JSON.

- [ ] **Step 4: Commit**

```bash
git add scripts/build.sh
git commit -m "chore(build): vite + tsc build script"
```

---

## Task 21: `SKILL.md` — agent-facing instructions

**Files:**
- Create: `SKILL.md`

- [ ] **Step 1: Create `SKILL.md`**

```markdown
---
name: agent-checklist
description: Publish your task checklist and real-time progress to the local Agent Checklist dashboard so the user can see what you and other agents are doing.
---

# Agent Checklist

Use this skill whenever you plan to complete a non-trivial, multi-step task. You publish your planned steps as a checklist; the user sees them on `http://localhost:51723` and watches you tick them off as you work.

## One-time prerequisites (the user must have done these)

1. `pnpm add -g agent-checklist` (or `npx agent-checklist`).
2. Added the MCP server in Claude Code config:
   ```json
   { "mcpServers": { "checklist": { "url": "http://localhost:51723/mcp" } } }
   ```
3. Installed the `SessionStart` hook that captures `$CLAUDE_SESSION_ID` and runs `agent-checklist ensure-running`.

If any of these is missing, the MCP tools will not be available or `$CLAUDE_SESSION_ID` will be empty. Tell the user and stop.

## When you start a task

1. **Get your agent ID.** Run this in Bash:
   ```bash
   echo "$CLAUDE_SESSION_ID"
   ```
   Use the UUID you see as your `agentId` in every tool call below. If it prints an empty line, tell the user the `SessionStart` hook is missing and stop.

2. **Register yourself** with the planned task list:
   ```
   register_agent({
     agentId: "<the UUID from step 1>",
     name: "<short title — e.g. 'Build login flow'>",
     tasks: ["First step", "Second step", ...]
   })
   ```
   Safe to call again if the server restarted during your session — it will re-register without duplicating tasks.

## As you work

- **Start a task:** `update_task({ agentId, taskId, status: "in_progress" })`. Only one task per agent can be in progress at a time; starting a new one auto-pauses the previous.
- **Finish a task:** `update_task({ agentId, taskId, status: "completed" })`.
- **Add a step mid-task:** `add_tasks({ agentId, tasks: ["new step"] })` (or with `afterTaskId` to insert in-place).
- **Drop a step:** `remove_task({ agentId, taskId })` (the task must not be in_progress).
- **Reorder:** `reorder_tasks({ agentId, taskIds: [...full new order...] })`.
- **Rename:** `rename_task({ agentId, taskId, label })`.
- **Add context to a task:** include `note` in `update_task`. Pass empty string `""` to clear.

## If the server isn't responding

The MCP client will surface the failure. Run in Bash:
```bash
agent-checklist ensure-running
```
Then retry the tool call. If it still fails, tell the user.

## Do not

- Invent your own agent ID — always use `$CLAUDE_SESSION_ID`.
- Call `POST /api/board/clear` — that's a human-only control.
- Register the same agent more than once with a different `name` — pick one name and keep it.
```

- [ ] **Step 2: Commit**

```bash
git add SKILL.md
git commit -m "docs: SKILL.md agent-facing instructions"
```

---

## Task 22: README (minimal) and final pass

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# agent-checklist

A local MCP server + web dashboard for tracking what your coding agents are doing, right now.

Open `http://localhost:51723` and watch every running Claude Code chat publish its checklist and tick off tasks in real time.

## Install

```bash
pnpm add -g agent-checklist
# or: npx agent-checklist start
```

## Configure Claude Code

1. Add the MCP server in `~/.claude/settings.json`:
   ```json
   {
     "mcpServers": { "checklist": { "url": "http://localhost:51723/mcp" } }
   }
   ```

2. Add the `SessionStart` hook so each session auto-starts the server and exposes its session ID:
   ```json
   {
     "hooks": {
       "SessionStart": [{
         "hooks": [{
           "type": "command",
           "command": "SID=$(cat | jq -r .session_id); echo \"CLAUDE_SESSION_ID=$SID\" >> \"$CLAUDE_ENV_FILE\"; agent-checklist ensure-running"
         }]
       }]
     }
   }
   ```

3. Install the agent-facing skill from `SKILL.md` in this package (drop it into your Claude Code skills directory, or paste its body into your `CLAUDE.md`).

Open a browser to `http://localhost:51723` and start a Claude Code chat. Tasks will appear as the agent registers and updates them.

## CLI

- `agent-checklist start` — foreground (Ctrl+C stops).
- `agent-checklist start-background` — fork into the background; exits when ready.
- `agent-checklist ensure-running` — probe + start if needed. Used by the hook.
- `agent-checklist status` — show health.
- `agent-checklist stop` — SIGTERM the running server.

## Environment variables

- `AGENT_CHECKLIST_PORT` (default `51723`)
- `AGENT_CHECKLIST_STATE_FILE` (default `~/.agent-checklist/state.json`)
- `AGENT_CHECKLIST_LOG_LEVEL` (default `warn`; accepted: `fatal`, `error`, `warn`, `info`, `debug`, `trace`)

## License

MIT.
```

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: all server + web tests pass.

- [ ] **Step 3: Run a full build smoke test**

Run:
```bash
pnpm build
AGENT_CHECKLIST_STATE_FILE=/tmp/ac-final.json node dist/server/index.js start-background
curl -s http://localhost:51723/api/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:51723/
node dist/server/index.js stop
```
Expected:
- `start-background` returns quickly
- health returns valid JSON
- dashboard HTTP status is 200
- `stop` exits 0

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README with install, config, and CLI reference"
```

---

## Post-implementation checklist

- [ ] `pnpm test` passes.
- [ ] `pnpm build` produces `dist/web` and `dist/server` with an executable `dist/server/index.js`.
- [ ] `node dist/server/index.js start` runs and serves dashboard + MCP + WebSocket.
- [ ] Calling `register_agent` via MCP surfaces a card in the browser instantly.
- [ ] Setting a task to `in_progress` auto-reverts any other `in_progress` task on the same agent.
- [ ] Killing the server with `SIGTERM` flushes state; relaunching shows the same agents marked `disconnected` and any previously `in_progress` tasks reverted to `pending` with a note.
- [ ] `agent-checklist status` and `agent-checklist stop` work.
- [ ] `SKILL.md` exists and ships with the package.
