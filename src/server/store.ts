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

export interface Store {
  getState(): BoardState;
  registerAgent(input: RegisterAgentInput): RegisterAgentResult;
  updateTask(input: UpdateTaskInput): UpdateTaskResult;
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

  return {
    getState: () => state,
    registerAgent,
    updateTask,
    markAllDisconnected,
    now,
  };
}
