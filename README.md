# Agent Checklist

A local dashboard and MCP server that shows your coding agents' real-time task checklists. When agents work on multi-step tasks, they publish their progress to a live web dashboard so you can see what's happening without reading through terminal output.

## How it works

When you start a coding session, the plugin automatically starts a local server and registers its MCP tools. As your agent works through a task, it calls MCP tools to register its checklist and update progress in real time. You watch it all happen on a live dashboard at `http://localhost:51723`.

Multiple agents can publish simultaneously — each gets its own card with a progress bar, task list, and activity indicator. Tasks transition through `pending` → `in_progress` → `completed`, with only one task active per agent at a time.

The dashboard auto-reconnects via WebSocket, so you can leave it open in a browser tab and it stays in sync.

## Installation

**Requirements:** Node.js >= 20.11.0, pnpm (recommended) or npm

### Claude Code (via Plugin Marketplace)

Register the marketplace:

```bash
/plugin marketplace add vanh-tran/agent-checklist
```

Install the plugin:

```bash
/plugin install agent-checklist@agent-checklist
```

The first session start after install will automatically run `pnpm install && pnpm build` to compile the server and web UI.

### Manual Setup

Clone and build:

```bash
git clone https://github.com/vanh-tran/agent-checklist.git
cd agent-checklist
pnpm install
pnpm build
```

Start the server:

```bash
node dist/server/index.js start
```

Then add the MCP server to your Claude Code settings:

```json
{ "mcpServers": { "checklist": { "url": "http://localhost:51723/mcp" } } }
```

### Global Install (optional)

```bash
pnpm add -g agent-checklist
agent-checklist start
```

## Automatic Updates

This plugin is distributed through a third-party marketplace (`vanh-tran/agent-checklist`). Auto-update is disabled by default for all third-party marketplaces.

### Enable Automatic Updates (Recommended)

Once enabled, Claude Code will automatically download the latest version every time you start it.

1. In Claude Code, type `/plugin` and press Enter
2. Switch to the **Marketplaces** tab
3. Find and select **`vanh-tran/agent-checklist`**
4. Choose **Enable auto-update**

You'll get a notification when an update is applied and may be asked to run `/reload-plugins`.

### Manual Update

```bash
/plugin marketplace update vanh-tran/agent-checklist
/plugin update agent-checklist@agent-checklist
```

Then restart Claude Code or run `/reload-plugins`.

## What's Inside

### MCP Tools

| Tool | Purpose |
|------|---------|
| `register_agent` | Register an agent with its planned task list |
| `update_task` | Set task status (`pending` / `in_progress` / `completed`) |
| `add_tasks` | Append or insert new tasks mid-work |
| `remove_task` | Remove a task (must not be in progress) |
| `reorder_tasks` | Replace the task order |
| `rename_task` | Update a task's label |
| `get_board` | Return the full board state |

### CLI Commands

```bash
agent-checklist start              # Run server in foreground
agent-checklist start-background   # Fork into background
agent-checklist ensure-running     # Start if not already running (idempotent)
agent-checklist status             # Check if server is running
agent-checklist stop               # Graceful shutdown
```

### Web Dashboard

Open `http://localhost:51723` to see the live dashboard. Features:

- Real-time updates via WebSocket
- Per-agent cards with progress bars
- Activity indicators (just now, idle, offline)
- Collapsible completed task sections
- Clear individual agents or the entire board

## Testing

Run the test suite:

```bash
pnpm test
```

Simulate two agents against a running server (30s per task, ~3 min total):

```bash
bash scripts/test-agents.sh
```

## Development

```bash
pnpm dev:server    # Server with hot reload (port 51723)
pnpm dev:web       # Vite dev server with HMR (port 5173, proxies to server)
pnpm lint:types    # Type check
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `AGENT_CHECKLIST_PORT` | `51723` | Server port |
| `AGENT_CHECKLIST_STATE_FILE` | `~/.agent-checklist/state.json` | Persistence file path |
| `AGENT_CHECKLIST_LOG_LEVEL` | `warn` | Fastify log level |

## License

MIT
