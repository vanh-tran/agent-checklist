import type { Task } from "@shared/types";

const statusIcon: Record<Task["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
};

const statusColor: Record<Task["status"], string> = {
  pending: "text-neutral-400",
  in_progress: "text-blue-600",
  completed: "text-green-600",
};

export interface TaskItemProps {
  task: Task;
}

export function TaskItem({ task }: TaskItemProps) {
  return (
    <div className="flex items-start gap-2 py-1 text-sm" data-testid={`task-${task.id}`}>
      <span className={`shrink-0 font-bold ${statusColor[task.status]}`} aria-label={task.status}>
        {statusIcon[task.status]}
      </span>
      <div className="min-w-0 flex-1">
        <div className={task.status === "completed" ? "line-through text-neutral-500" : ""}>
          {task.label}
        </div>
        {task.note && <div className="text-xs text-neutral-500 italic">{task.note}</div>}
      </div>
    </div>
  );
}
