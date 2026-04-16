import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Agent, Task, WsMessage } from "../shared/types.js";
import type { Store } from "./store.js";
import { Broadcaster } from "./broadcast";

interface Ctx {
  store: Store
  broadcaster: Broadcaster
}

interface ToolResult {
  [key: string]: unknown;
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