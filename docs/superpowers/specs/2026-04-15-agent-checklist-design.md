# Agent Checklist: Design Spec

**Status:** Draft
**Date:** 2026-04-15
**Owner:** vanhtran18

## Problem

When a developer runs multiple coding agents in parallel (multiple Claude Code chats, sub-agents, background tasks), there is no shared view of what each agent is supposed to do and how far along it is. Agents forget parts of their plan; humans lose track of who is doing what. The developer has to poll each agent individually to learn its status.

## Goal

Ship a local tool that each coding agent calls during its work to publish its checklist and progress to a shared dashboard. The developer opens a browser tab and sees every running agent at once, updating in real time.

### In scope (v1)

- Real-time dashboard showing all concurrent agents and their tasks.
- MCP server exposing tools agents call from Claude Code (and any MCP-compatible host).
- Local persistence so the board survives server restarts.
- Auto-start: the first agent to call the server boots it; subsequent agents discover and reuse it.

### Out of scope (v1, planned for v2+)

- Historical session import (reconstructing checklists from past Claude Code chat transcripts).
- Multi-user / team-sharing. This is a single-developer local tool.
- Agent-to-agent coordination or messaging.
- Authentication. The server binds to `localhost` only.
- Per-project boards. v1 assumes the user works on one project at a time and uses one global board stored at `~/.agent-checklist/state.json`.

## User Experience

### Install & first run

One-time setup (to be automated later as a plugin):

1. Install the package: `pnpm add -g agent-checklist` (or `npx agent-checklist`).
2. Add an MCP entry in Claude Code config pointing at the local URL:
   ```json
   { "mcpServers": { "checklist": { "url": "http://localhost:51723/mcp" } } }
   ```
3. Install the `SessionStart` hook that ships with the package. The hook does two jobs on every Claude Code session start: (a) writes `CLAUDE_SESSION_ID=<uuid>` to `$CLAUDE_ENV_FILE` so the agent can read it later, and (b) runs `agent-checklist ensure-running` to boot the server if it is not alive. Example config for `~/.claude/settings.json`:
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
4. Install the agent-facing skill shipped in the package as `SKILL.md`. The skill tells agents how to register themselves, how to read `$CLAUDE_SESSION_ID`, and how to call the MCP tools during work.

### Agent flow

1. User runs `claude` in a terminal and gives it a task.
2. The `SessionStart` hook fires. It captures the Claude Code session UUID into `$CLAUDE_SESSION_ID` (via `CLAUDE_ENV_FILE`) and ensures the server is running.
3. The agent reads `$CLAUDE_SESSION_ID` (via `echo $CLAUDE_SESSION_ID` in a Bash call) and uses it as its `agentId`.
4. Agent calls `register_agent({ agentId: $CLAUDE_SESSION_ID, name, tasks })`. A card appears on the dashboard immediately.
5. As the agent works, it calls `update_task` with `in_progress` / `completed` statuses. It may call `add_tasks`, `remove_task`, `reorder_tasks`, or `rename_task` if the plan changes.
6. The browser tab reflects every update in real time via WebSocket.

### Human flow

1. User opens `http://localhost:51723` in a browser.
2. Sees a grid of cards, one per running agent, each showing its checklist and current progress.
3. Tasks marked `in_progress` are highlighted so the user knows what each agent is doing right now.
4. User can clear individual agents or reset the whole board from the UI.

## Architecture

### Single-package layout

```
agent-checklist/
  package.json              runtime + dev deps, one version
  tsconfig.json
  vite.config.ts
  src/
    shared/                 shared types
    server/                 Fastify + MCP tools + store + CLI entry
    web/                    React source (index.html, App.tsx, components/, hooks/)
  scripts/
    build.sh                vite build → tsc → bundle into dist/
  dist/                     published artifact
    server/                 compiled JS; CLI entry lives here
    web/                    built static assets served by the server
```

The frontend and backend live in one package because the web source is a build-time artifact: it produces static assets that the server serves. There is no separate runtime consumer of the web package.

Runtime deps (`fastify`, `@modelcontextprotocol/sdk`, `zod`, etc.) sit in `dependencies`. Frontend tooling (`react`, `vite`, `tailwindcss`, `tsx`, `typescript`) sits in `devDependencies` and does not ship to users.

### Process model

One Fastify process bound to `http://localhost:51723`:

- `GET /` → React dashboard (static assets built by Vite).
- `GET /api/health` → service identity + liveness (available as soon as the process is listening).
- `GET /api/ready` → readiness (available only once every other endpoint is wired and state is loaded).
- `GET /api/state` → current `BoardState` JSON.
- `POST /api/agents/:id/clear` → remove one agent from the board (UI-initiated).
- `POST /api/board/clear` → wipe all agents (UI-initiated).
- `GET /ws` → WebSocket for live updates.
- `ALL /mcp` → Streamable HTTP MCP endpoint.

### Transport

MCP: **Streamable HTTP** (the current recommended transport per the MCP spec). Stdio is rejected because each agent would get its own subprocess and lose the shared board. SSE is rejected because it is the legacy transport.

## Data Model

```ts
type TaskStatus = "pending" | "in_progress" | "completed";
type ConnectionStatus = "connected" | "disconnected";

interface Task {
  id: string;              // `${agentId}-t0`, `${agentId}-t1`, ... from a monotonic counter
  label: string;
  status: TaskStatus;
  note?: string;           // optional context supplied by the agent
  updatedAt: string;       // ISO 8601
}

interface Agent {
  id: string;              // = Claude Code session UUID (or a user-chosen value)
  name: string;            // card title
  tasks: Task[];
  nextTaskSeq: number;     // monotonic counter; increments every time a task is created
  source: "live" | "imported";      // "imported" reserved for v2 historical import
  connectionStatus: ConnectionStatus; // flips to "disconnected" on server restart; back to "connected" on next MCP call
  startedAt: string;
  lastActivityAt: string;           // drives idle detection
}

interface BoardState {
  schemaVersion: 1;                 // bump when the shape changes; old files are migrated on load
  agents: Record<string, Agent>;
}
```

### Task ID generation

Task IDs are derived from a per-agent monotonic counter (`nextTaskSeq`) stored on the agent record. Each time a task is created (via `register_agent` or `add_tasks`), the counter is used for the new task's ID and then incremented. Removing tasks never rewinds the counter, so IDs are stable and never reused across the agent's lifetime.

### Persistence

Full `BoardState` (including `schemaVersion`) is serialised to `~/.agent-checklist/state.json` on change. Writes are debounced to ~200 ms to coalesce bursts. The file is loaded on server startup.

If a write fails (disk full, permissions), the server logs the error and keeps serving from memory. On the next successful write the in-memory state is saved.

On startup, if the file's `schemaVersion` is older than the current version, an in-process migration function upgrades it before use. Unknown (newer) versions cause a clear startup error.

### Server restart recovery

On startup, the server iterates every loaded agent and applies two corrections so the dashboard stays honest:

1. Set `connectionStatus` to `"disconnected"`. It flips back to `"connected"` the next time that agent calls any MCP tool.
2. Revert every `in_progress` task to `pending` (with `note = "server restarted"` when no existing note is set). The agent's chat may be long gone — we cannot keep claiming something is actively in progress.

The dashboard renders `disconnected` agents with a dimmed style and an "offline · last seen Xm ago" label.

### Graceful shutdown

The server registers handlers for `SIGTERM` and `SIGINT`:

1. Flush the pending debounced write immediately (synchronously if needed) so no updates are lost.
2. Close the HTTP server (drains in-flight requests).
3. Close all WebSocket clients.
4. Exit 0.

`agent-checklist stop` sends `SIGTERM` and waits up to 5 s for the process to exit cleanly before reporting a failure.

### Idle detection

An agent whose `lastActivityAt` is older than 10 minutes is rendered as "idle" in the UI (grayed out). Agents are never deleted server-side; the user decides when to clear them.

## MCP Tool Surface

All tools validate input with Zod schemas and return structured responses. Errors return `isError: true` with a clear message.

| Tool | Input | Behavior |
|---|---|---|
| `register_agent` | `{ agentId, name, tasks: string[] }` | Creates a new agent. `agentId` should be the caller's Claude Code session UUID. Initializes `nextTaskSeq = tasks.length`. Returns the generated `taskIds`. If an agent with the same `agentId` and `name` already exists, this is treated as a re-register (flips `connectionStatus` to `"connected"`, resets `lastActivityAt`, returns existing `taskIds` unchanged). A matching `agentId` with a different `name` errors. |
| `update_task` | `{ agentId, taskId, status, note? }` | Sets status. Updates `updatedAt` and flips the agent's `connectionStatus` to `"connected"` and `lastActivityAt` to now. If `status === "in_progress"`, any other task on that agent that is currently `in_progress` is automatically reverted to `pending` so at most one task per agent is `in_progress` at a time. Omitting `note` preserves any existing note; passing an empty string clears it. |
| `add_tasks` | `{ agentId, tasks: string[], afterTaskId? }` | Appends tasks (or inserts after `afterTaskId`). Uses the per-agent `nextTaskSeq` counter for IDs. Returns new `taskIds`. |
| `remove_task` | `{ agentId, taskId }` | Removes a task. Errors if the task is `in_progress`. |
| `reorder_tasks` | `{ agentId, taskIds: string[] }` | Replaces the ordered list. Errors if the set of IDs does not match current tasks exactly. |
| `rename_task` | `{ agentId, taskId, label }` | Updates the label. |
| `get_board` | `{}` | Returns the full `BoardState`. Lets an agent self-check or read others' status. |

Every mutation broadcasts the appropriate WebSocket event so every connected browser tab updates without reloading.

## REST API

Used by the dashboard UI and by CLI subcommands. Not intended for agents (they use MCP).

- `GET /api/health` → `{ service: "agent-checklist", version, pid, startedAt }`. Used for liveness, identity verification, and PID discovery by `agent-checklist stop`. Returns `200` as soon as the Fastify process is listening, even if other endpoints are still being mounted.
- `GET /api/ready` → `200 { ok: true }` only after every endpoint (`/api/state`, `/mcp`, `/ws`, static assets) is fully wired and the state file has been loaded. `agent-checklist start-background` polls this, not `/api/health`, so agents never hit a partially-mounted server.
- `GET /api/state` → initial `BoardState` for dashboard hydration before WebSocket connects.
- `POST /api/agents/:id/clear` → delete one agent.
- `POST /api/board/clear` → delete all agents.

The dashboard fetches `/api/state` on mount, then relies on the WebSocket for deltas. On WebSocket reconnect it refetches state to avoid drift from missed messages.

## WebSocket Protocol

```ts
type WsMessage =
  | { type: "state";         payload: BoardState }
  | { type: "agent_updated"; payload: Agent }
  | { type: "task_updated";  payload: { agentId: string; task: Task } }
  | { type: "agent_removed"; payload: { agentId: string } };
```

The server sends `state` once on connect, then one of the other events on each change.

## Dashboard UI

### Layout

Grid of cards (`auto-fill, minmax(320px, 1fr)`). One card per agent. `align-items: start` so cards do not stretch to match siblings — each finds its natural height up to a max, then scrolls internally.

### Card anatomy

- Header: agent name, menu with `Clear` and `Rename` actions.
- Progress summary: "3 of 7 done · 2m ago".
- Slim progress bar.
- Task list with color-coded status icons: green check for `completed`, blue half-circle for `in_progress`, gray open circle for `pending`.
- Completed tasks auto-collapse behind a `Show N completed ▸` toggle when there are more than 5.
- The `in_progress` task is always kept in view (`scrollIntoView` on update).

### Overflow handling

Each card has a max height (≈ 500 px). Task lists longer than that scroll inside the card so the grid stays visually even.

### Global controls

- Connection indicator (green dot = WebSocket connected, red = reconnecting).
- "Reset board" button with a confirm dialog, calls `POST /api/board/clear`.

## Startup & Discovery

### Fixed port

Default port: `51723`. Override with env var `AGENT_CHECKLIST_PORT` for users with conflicts.

### Identity

The server identifies itself at `GET /api/health` with `{ service: "agent-checklist", version, pid, startedAt }`. Any probe that wants to verify "is agent-checklist running on this port?" calls this endpoint and checks `service`. A generic port probe is not enough because another service could be on the same port.

### No lock file

The health endpoint is the sole source of truth for liveness. The server does not write a PID file. `agent-checklist stop` reads the PID from `/api/health` and sends SIGTERM.

### Agent auto-start flow

Triggered by the `SessionStart` hook rather than by the agent itself, so the server is up before the agent needs it. The hook runs `agent-checklist ensure-running`, which:

1. Probes `GET http://localhost:51723/api/health` with a 2 s timeout.
2. If the response has `service: "agent-checklist"`, exit 0.
3. If there is no response, spawn the server via `start-background`. The subcommand polls `/api/ready` until it returns 200, then exits 0.
4. Retry the health probe up to 3 times with backoff (200 ms, 500 ms, 1 s).
5. If probes keep failing, exit non-zero with a clear error so the hook visibly fails and the user can investigate.

The flow is duplicated in `SKILL.md` for cases where the agent needs to recover from mid-session server death (the hook only fires at session start).

### CLI subcommands

- `agent-checklist start` — foreground, logs to stdout, Ctrl+C stops.
- `agent-checklist start-background` — forks detached, polls `/api/ready`, exits 0 when ready, exits non-zero after ~5 s if startup fails.
- `agent-checklist ensure-running` — the combined probe + start used by the hook.
- `agent-checklist status` — probes `/api/health`, prints result.
- `agent-checklist stop` — reads PID from `/api/health`, sends SIGTERM, waits up to 5 s for graceful exit.

### Race handling

Two agents starting simultaneously may both spawn the server. The second `Fastify.listen()` call fails with `EADDRINUSE`. The retry-probe loop in step 4 of the agent flow finds the first server healthy and proceeds. The race is self-healing.

## Error Handling

### MCP tool errors

All MCP tools return `isError: true` with a human-readable message on failure:

- `register_agent` called with an `agentId` that already exists and has the same `name` → no error; treated as a re-register (see "Duplicate `register_agent` after server restart" below).
- `register_agent` called with an `agentId` that already exists but a different `name` → "Agent ID already in use with a different name. Use the existing name or choose a new ID."
- `update_task` with unknown `agentId` or `taskId` → "Agent or task not found."
- `remove_task` on an `in_progress` task → "Cannot remove a task in progress. Mark it `pending` or `completed` first."
- `reorder_tasks` with a mismatched ID set → "Reorder list must contain exactly the current task IDs."

### Persistence failures

If the debounced write to `state.json` fails, the server logs the error and keeps serving from memory. The next successful write captures everything.

### WebSocket disconnects

The React hook already reconnects on `close`. On reconnect, the hook refetches `/api/state` to avoid drift from messages missed during the disconnect.

### Server crashes

Graceful shutdown on `SIGTERM` / `SIGINT` flushes the pending debounced write before exit, so clean stops lose nothing. A hard kill (e.g., `kill -9`) can still lose up to ~200 ms of updates. Acceptable for v1. There is no transactional log.

### Duplicate `register_agent` after server restart

When a session resumes but the server has restarted, the agent will call `register_agent` again with the same session UUID. The tool handles this by treating a matching existing agent as "re-register": it updates `connectionStatus` to `"connected"`, resets `lastActivityAt`, and returns the current `taskIds` unchanged (no duplicate tasks are created). Only a genuinely conflicting `agentId` (different `name` or shape) surfaces an error.

## Testing Approach

- **Server / MCP unit tests.** Test `store.ts` (register, update, add, remove, reorder, rename) against a temp JSON file on disk. Use `node:test` + `tsx`.
- **Server integration tests.** Boot Fastify on a random port, call each MCP tool via Streamable HTTP, subscribe to `/ws`, assert the expected broadcasts fire.
- **React component tests.** Vitest + React Testing Library for card, board, and hook behavior.
- **No mocked database.** Integration tests use a real temp file, consistent with the global preference of not mocking persistence layers.
- **No E2E tests for v1.** Manual browser testing covers the UI integration. Playwright can be added if regressions show up.

## Distribution

v1 ships as a single npm package `agent-checklist`. The build script runs `vite build` to produce `dist/web/`, then `tsc` to compile the server into `dist/server/`. `npm publish` ships `dist/` + `package.json`.

The package's `bin` entry exposes the `agent-checklist` CLI. Users can install globally (`pnpm add -g agent-checklist`) or invoke via `npx agent-checklist`.

The package ships a `SKILL.md` agent-facing skill file. Users install it as a Claude Code skill or paste its body into their `CLAUDE.md`.

A future v1.1 may wrap the package as a Claude Code plugin that installs the MCP config, the SessionStart hook, and the skill automatically.

## Out of Scope but Planned

- **v2: Historical import.** A CLI subcommand reads past Claude Code chat transcripts from `~/.claude/projects/.../` and reconstructs checklists by summarizing each session. Imported agents have `source: "imported"` so the UI can filter or label them.
- **v2: Session browser.** The dashboard gains a switcher between "Live" and historical dates.
- **v2+: Agent notes & artifacts.** Attach links (PR URLs, file paths) to completed tasks.

## Open Questions

None blocking v1. All design decisions above are agreed.
