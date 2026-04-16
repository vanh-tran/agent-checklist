export interface ConnectionIndicatorProps {
  connected: boolean;
}

export function ConnectionIndicator({ connected }: ConnectionIndicatorProps) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-neutral-500" aria-live="polite">
      <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} aria-hidden />
      {connected ? "connected" : "reconnecting\u2026"}
    </span>
  );
}
