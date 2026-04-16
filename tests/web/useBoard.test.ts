import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBoard } from "../../src/web/src/hooks/useBoard";

type Handler = (ev: MessageEvent) => void;

class MockWs {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: Handler | null = null;
  close = vi.fn();
  constructor() { MockWs.instances.push(this); }
  static instances: MockWs[] = [];
  fireOpen() { this.onopen?.(); }
  fireMessage(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
}

beforeEach(() => {
  MockWs.instances = [];
  (globalThis as any).WebSocket = MockWs;
  (globalThis as any).fetch = vi.fn(async () =>
    new Response(JSON.stringify({ schemaVersion: 1, agents: {} }), { status: 200 }),
  );
});

describe("useBoard", () => {
  it("hydrates from /api/state and handles state message", async () => {
    const { result } = renderHook(() => useBoard());
    const ws = MockWs.instances[0]!;
    act(() => ws.fireOpen());
    await waitFor(() => expect(result.current.connected).toBe(true));
    act(() =>
      ws.fireMessage({
        type: "state",
        payload: {
          schemaVersion: 1,
          agents: {
            a: { id: "a", name: "A", tasks: [], nextTaskSeq: 0, source: "live", connectionStatus: "connected", startedAt: "x", lastActivityAt: "x" },
          },
        },
      }),
    );
    await waitFor(() => expect(result.current.board.agents.a?.name).toBe("A"));
  });

  it("agent_removed drops the agent", async () => {
    const { result } = renderHook(() => useBoard());
    const ws = MockWs.instances[0]!;
    act(() => ws.fireOpen());
    act(() =>
      ws.fireMessage({
        type: "state",
        payload: {
          schemaVersion: 1,
          agents: {
            a: { id: "a", name: "A", tasks: [], nextTaskSeq: 0, source: "live", connectionStatus: "connected", startedAt: "x", lastActivityAt: "x" },
          },
        },
      }),
    );
    act(() => ws.fireMessage({ type: "agent_removed", payload: { agentId: "a" } }));
    await waitFor(() => expect(result.current.board.agents.a).toBeUndefined());
  });
});
