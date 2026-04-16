import type { BoardState } from "@shared/types";
import { AgentCard } from "./AgentCard";

export interface BoardProps {
  state: BoardState;
}

export function Board({ state }: BoardProps) {
  const agents = Object.values(state.agents).sort(
    (a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt),
  );

  async function onClear(agentId: string) {
    if (!window.confirm(`Remove agent "${state.agents[agentId]?.name ?? agentId}" from the board?`)) return;
    await fetch(`/api/agents/${encodeURIComponent(agentId)}/clear`, { method: "POST" });
  }

  if (agents.length === 0) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-neutral-500">
        No agents yet. Register one via the MCP tool to see it appear here.
      </div>
    );
  }

  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", alignItems: "start" }}
    >
      {agents.map((a) => <AgentCard key={a.id} agent={a} onClear={onClear} />)}
    </div>
  );
}
