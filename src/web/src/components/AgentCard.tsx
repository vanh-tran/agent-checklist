import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Agent } from "@shared/types";
import { TaskItem } from "./TaskItem";
import { ProgressBar } from "./ProgressBar";

export interface AgentCardProps {
  agent: Agent;
  onClear: (agentId: string) => void;
}

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function AgentCard({ agent, onClear }: AgentCardProps) {
  const completed = agent.tasks.filter((t) => t.status === "completed");
  const active = agent.tasks.filter((t) => t.status !== "completed");
  const [showCompleted, setShowCompleted] = useState(completed.length <= 5);
  const listRef = useRef<HTMLDivElement>(null);
  const inProgressId = useMemo(
    () => agent.tasks.find((t) => t.status === "in_progress")?.id,
    [agent.tasks],
  );

  useEffect(() => {
    if (!inProgressId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-testid="task-${inProgressId}"]`);
    (el as HTMLElement | null)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [inProgressId]);

  const IDLE_MS = 10 * 60 * 1000;
  const isDisconnected = agent.connectionStatus === "disconnected";
  const isIdle =
    !isDisconnected && Date.now() - new Date(agent.lastActivityAt).getTime() > IDLE_MS;
  const isDim = isDisconnected || isIdle;

  const subtitle = isDisconnected
    ? `offline · last seen ${timeSince(agent.lastActivityAt)}`
    : isIdle
    ? `idle · last seen ${timeSince(agent.lastActivityAt)}`
    : timeSince(agent.lastActivityAt);

  return (
    <article
      className={`flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm ${isDim ? "opacity-60" : ""}`}
      data-testid={`agent-${agent.id}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{agent.name}</h2>
          <div className="text-xs text-neutral-500">
            {completed.length} of {agent.tasks.length} done · {subtitle}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onClear(agent.id)}
          className="text-xs text-neutral-500 hover:text-red-600"
          aria-label={`Clear agent ${agent.name}`}
        >
          Clear
        </button>
      </header>

      <ProgressBar done={completed.length} total={agent.tasks.length} />

      <div ref={listRef} className="max-h-[380px] overflow-y-auto">
        {active.map((t) => <TaskItem key={t.id} task={t} />)}
        {completed.length > 0 && (
          <button
            type="button"
            className="mt-2 text-xs text-neutral-500 hover:text-neutral-800"
            onClick={() => setShowCompleted((v) => !v)}
          >
            {showCompleted ? "▾" : "▸"} {completed.length} completed
          </button>
        )}
        {showCompleted && completed.map((t) => <TaskItem key={t.id} task={t} />)}
      </div>
    </article>
  );
}
