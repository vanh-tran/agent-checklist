import type { BoardState, Agent, Task } from "../shared/types.js";

const state: BoardState = { agents: {} };

export function getState(): BoardState {
  return state;
}

export function registerAgent(
  agentId: string,
  name: string,
  taskLabels: string[]
): Agent {
  const tasks: Task[] = taskLabels.map((label, i) => ({
    id: `${agentId}-task-${i}`,
    label,
    done: false,
    agentId,
    updatedAt: new Date().toISOString(),
  }));

  const agent: Agent = {
    id: agentId,
    name,
    tasks,
    createdAt: new Date().toISOString(),
  };

  state.agents[agentId] = agent;
  return agent;
}

export function tickTask(
  agentId: string,
  taskId: string,
  done = true
): Task | null {
  const agent = state.agents[agentId];
  if (!agent) return null;

  const task = agent.tasks.find((t) => t.id === taskId);
  if (!task) return null;

  task.done = done;
  task.updatedAt = new Date().toISOString();
  return task;
}
