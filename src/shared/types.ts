export interface Task {
  id: string;
  label: string;
  done: boolean;
  agentId: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  name: string;
  tasks: Task[];
  createdAt: string;
}

export interface BoardState {
  agents: Record<string, Agent>;
}

// WebSocket message types
export type WsMessage =
  | { type: "state"; payload: BoardState }
  | { type: "agent_updated"; payload: Agent }
  | { type: "task_updated"; payload: { agentId: string; task: Task } };

// MCP tool input schemas (validated via zod on server)
export interface RegisterAgentInput {
  agentId: string;
  name: string;
  tasks: string[]; // task labels
}

export interface TickTaskInput {
  agentId: string;
  taskId: string;
  done?: boolean; // default true
}
