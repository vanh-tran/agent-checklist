import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerAgent, tickTask, getState } from "./store.js";
import { broadcast } from "./broadcast.js";

export function createMcpServer() {
  const mcp = new McpServer({
    name: "agent-checklist",
    version: "0.1.0",
  });

  // Tool: register an agent with its task list
  mcp.tool(
    "register_agent",
    "Register this agent on the dashboard with its planned task checklist",
    {
      agentId: z.string().describe("Unique ID for this agent (e.g. 'agent-1')"),
      name: z.string().describe("Human-readable name shown on the dashboard"),
      tasks: z.array(z.string()).describe("Ordered list of task descriptions"),
    },
    async ({ agentId, name, tasks }) => {
      const agent = registerAgent(agentId, name, tasks);
      broadcast({ type: "agent_updated", payload: agent });
      return {
        content: [
          {
            type: "text",
            text: `Registered agent "${name}" with ${tasks.length} tasks. IDs: ${agent.tasks.map((t) => t.id).join(", ")}`,
          },
        ],
      };
    }
  );

  // Tool: tick (or untick) a task
  mcp.tool(
    "tick_task",
    "Mark a task as done (or not done) on the dashboard",
    {
      agentId: z.string().describe("The agent ID used during registration"),
      taskId: z.string().describe("The task ID returned from register_agent"),
      done: z.boolean().optional().describe("true = done, false = undo. Defaults to true"),
    },
    async ({ agentId, taskId, done }) => {
      const task = tickTask(agentId, taskId, done ?? true);
      if (!task) {
        return {
          content: [{ type: "text", text: `Error: agent or task not found` }],
          isError: true,
        };
      }
      broadcast({ type: "task_updated", payload: { agentId, task } });
      return {
        content: [
          {
            type: "text",
            text: `Task "${task.label}" marked as ${task.done ? "✅ done" : "⬜ not done"}`,
          },
        ],
      };
    }
  );
  // Tool: get current board state (useful for agents to self-check)
  mcp.tool(
    "get_board",
    "Get the current state of the dashboard (all agents and tasks)",
    {},
    async () => {
      const state = getState();
      return {
        content: [{ type: "text", text: JSON.stringify(state, null, 2) }],
      };
    }
  );

  return mcp;
}
