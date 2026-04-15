import { useEffect, useState } from "react";
import type { BoardState, WsMessage } from "../../../shared/types";

const WS_URL = `ws://${window.location.host}/ws`;

export function useBoard() {
  const [board, setBoard] = useState<BoardState>({ agents: {} });
  const [connected, setConnected] = useState(false);

useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (e) => {
      const msg: WsMessage = JSON.parse(e.data);

      if (msg.type === "state") {
        setBoard(msg.payload);
      } else if (msg.type === "agent_updated") {
        setBoard((prev) => ({
          agents: { ...prev.agents, [msg.payload.id]: msg.payload },
        }));
      } else if (msg.type === "task_updated") {
        setBoard((prev) => {
          const agent = prev.agents[msg.payload.agentId];
          if (!agent) return prev;
          return {
            agents: {
              ...prev.agents,
              [msg.payload.agentId]: {
                ...agent,
                tasks: agent.tasks.map((t) =>
                  t.id === msg.payload.task.id ? msg.payload.task : t
                ),
              },
            },
          };
        });
      }
};

 return () => ws.close();
  }, []);

  return { board, connected };
}
