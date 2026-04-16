import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Board } from "../../src/web/src/components/Board";
import type { BoardState } from "../../src/shared/types";

describe("Board", () => {
  it("renders empty state when there are no agents", () => {
    const state: BoardState = { schemaVersion: 1, agents: {} };
    render(<Board state={state} />);
    expect(screen.getByText(/no agents yet/i)).toBeTruthy();
  });

  it("renders one card per agent sorted by lastActivityAt desc", () => {
    const state: BoardState = {
      schemaVersion: 1,
      agents: {
        old: {
          id: "old", name: "Old", tasks: [], nextTaskSeq: 0, source: "live", connectionStatus: "connected",
          startedAt: "2026-04-15T00:00:00Z", lastActivityAt: "2026-04-15T00:00:00Z",
        },
        new: {
          id: "new", name: "New", tasks: [], nextTaskSeq: 0, source: "live", connectionStatus: "connected",
          startedAt: "2026-04-15T01:00:00Z", lastActivityAt: "2026-04-15T01:00:00Z",
        },
      },
    };
    const { container } = render(<Board state={state} />);
    const names = Array.from(container.querySelectorAll("article h2")).map((n) => n.textContent);
    expect(names).toEqual(["New", "Old"]);
  });
});
