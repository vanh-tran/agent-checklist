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

export interface Store {
  getState(): BoardState;
  registerAgent(input: RegisterAgentInput): RegisterAgentResult;
  updateTask(input: UpdateTaskInput): UpdateTaskResult;
  addTasks(input: AddTasksInput): AddTasksResult;
  removeTask(input: RemoveTaskInput): { agent: Agent };
  reorderTasks(input: ReorderTasksInput): { agent: Agent };
  renameTask(input: RenameTaskInput): { agent: Agent; task: Task };
  removeAgent(input: RemoveAgentInput): boolean;
  clearAll(): void;
  applyRestartRecovery(): void;
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

  function requireAgent(agentId: string): Agent {
    const a = state.agents[agentId];
    if (!a) throw new Error(`Agent "${agentId}" not found.`);
    return a;
  }

  function updateTask(input: UpdateTaskInput): UpdateTaskResult {
    const agent = requireAgent(input.agentId);
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

  return {
    getState: () => state,
    registerAgent,
    updateTask,
    addTasks,
    removeTask,
    reorderTasks,
    renameTask,
    removeAgent,
    clearAll,
    applyRestartRecovery,
    markAllDisconnected,
    now,
  };
}
