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
