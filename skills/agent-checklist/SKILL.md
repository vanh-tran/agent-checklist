---
name: agent-checklist
description: Publish your task checklist and real-time progress to the local Agent Checklist dashboard so the user can see what you and other agents are doing.
---

# Agent Checklist

Use this skill whenever you plan to complete a non-trivial, multi-step task. You publish your planned steps as a checklist; the user sees them on `http://localhost:51723` and watches you tick them off as you work.

## Prerequisites

The plugin's `.mcp.json` and `SessionStart` hook handle MCP registration and server auto-start automatically. If the MCP tools are not available or `$CLAUDE_SESSION_ID` is empty, tell the user to reinstall the plugin and restart their session.

## When you start a task

1. **Get your agent ID.** Run this in Bash:
   ```bash
   cat /tmp/claude-session-id
   ```
   Use the UUID you see as your `agentId` in every tool call below. If the file is missing or empty, tell the user the `SessionStart` hook is not installed and stop.

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

- Invent your own agent ID — always read it from `/tmp/claude-session-id`.
- Call `POST /api/board/clear` — that's a human-only control.
- Register the same agent more than once with a different `name` — pick one name and keep it.
