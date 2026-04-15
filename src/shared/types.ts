export const SCHEMA_VERSION = 1 as const;

export type TaskStatus = "pending" | "in_progress" | "completed";
export type ConnectionStatus = "connected" | "disconnected";
export type AgentSource = "live" | "imported";

export interface Task {
  id: string;
  label: string;
  status: TaskStatus;
  note?: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  name: string;
  tasks: Task[];
  nextTaskSeq: number;
  source: AgentSource;
  connectionStatus: ConnectionStatus;
  startedAt: string;
  lastActivityAt: string;
}

export interface BoardState {
  schemaVersion: typeof SCHEMA_VERSION;
  agents: Record<string, Agent>;
}

export type WsMessage =
  | { type: "state"; payload: BoardState }
  | { type: "agent_updated"; payload: Agent }
  | { type: "task_updated"; payload: { agentId: string; task: Task } }
  | { type: "agent_removed"; payload: { agentId: string } };

export interface HealthResponse {
  service: "agent-checklist";
  version: string;
  pid: number;
  startedAt: string;
}