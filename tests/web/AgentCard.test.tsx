import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentCard } from "../../src/web/src/components/AgentCard";
import type { Agent } from "../../src/shared/types";

function make(agent: Partial<Agent>): Agent {
  return {
    id: "a",
    name: "Login",
    tasks: [],
    nextTaskSeq: 0,
    source: "live",
    connectionStatus: "connected",
    startedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    ...agent,
  };
}

describe("AgentCard", () => {
  it("shows progress counts and renders tasks", () => {
    const agent = make({
      tasks: [
        { id: "a-t0", label: "A", status: "completed", updatedAt: "x" },
        { id: "a-t1", label: "B", status: "in_progress", updatedAt: "x" },
        { id: "a-t2", label: "C", status: "pending", updatedAt: "x" },
      ],
    });
    render(<AgentCard agent={agent} onClear={() => {}} />);
    expect(screen.getByText(/1 of 3 done/)).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
    expect(screen.getByText("C")).toBeTruthy();
  });

  it("hides completed by default when there are more than 5", () => {
    const tasks = Array.from({ length: 7 }, (_, i) => ({
      id: `a-t${i}`, label: `Done${i}`, status: "completed" as const, updatedAt: "x",
    }));
    render(<AgentCard agent={make({ tasks })} onClear={() => {}} />);
    expect(screen.queryByText("Done0")).toBeNull();
    fireEvent.click(screen.getByText(/7 completed/));
    expect(screen.getByText("Done0")).toBeTruthy();
  });

  it("calls onClear when clear button pressed", () => {
    const onClear = vi.fn();
    render(<AgentCard agent={make({})} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: /clear agent login/i }));
    expect(onClear).toHaveBeenCalledWith("a");
  });

  it("dims disconnected agents", () => {
    const { container } = render(
      <AgentCard agent={make({ connectionStatus: "disconnected" })} onClear={() => {}} />,
    );
    expect(container.querySelector("[data-testid='agent-a']")?.className).toMatch(/opacity-60/);
  });
});
