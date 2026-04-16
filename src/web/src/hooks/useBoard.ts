import { useEffect, useRef, useState } from "react";
import type { BoardState, WsMessage, Agent, Task } from "@shared/types";

export interface UseBoardResult {
  board: BoardState;
  connected: boolean;
}

const EMPTY_BOARD: BoardState = { schemaVersion: 1, agents: {} };

export function useBoard(): UseBoardResult {
  const [board, setBoard] = useState<BoardState>(EMPTY_BOARD);
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const r = await fetch("/api/state");
        if (r.ok && !cancelled) {
          const s = (await r.json()) as BoardState;
          setBoard(s);
        }
      } catch { /* will retry via WS fallback */ }
    }

    function applyMessage(msg: WsMessage) {
      setBoard((prev) => {
        if (msg.type === "state") return msg.payload;
        if (msg.type === "agent_updated") {
          return { ...prev, agents: { ...prev.agents, [msg.payload.id]: msg.payload } };
        }
        if (msg.type === "agent_removed") {
          const { [msg.payload.agentId]: _, ...rest } = prev.agents;
          return { ...prev, agents: rest };
        }
        if (msg.type === "task_updated") {
          const agent = prev.agents[msg.payload.agentId];
          if (!agent) return prev;
          const tasks: Task[] = agent.tasks.map((t) =>
            t.id === msg.payload.task.id ? msg.payload.task : t,
          );
          const nextAgent: Agent = { ...agent, tasks, lastActivityAt: msg.payload.task.updatedAt, connectionStatus: "connected" };
          return { ...prev, agents: { ...prev.agents, [msg.payload.agentId]: nextAgent } };
        }
        return prev;
      });
    }

    function connect() {
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setConnected(true);
        void hydrate();
      };
      ws.onclose = () => {
        setConnected(false);
        reconnectTimer.current = setTimeout(connect, 1000);
      };
      ws.onmessage = (e) => {
        try {
          applyMessage(JSON.parse(String(e.data)) as WsMessage);
        } catch {
          /* drop malformed */
        }
      };
      return () => ws.close();
    }

    const dispose = connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      dispose?.();
    };
  }, []);

  return { board, connected };
}
