export const DEFAULT_PORT = 51723;

export function readPort(): number {
  const raw = process.env.AGENT_CHECKLIST_PORT;
  if (!raw) return DEFAULT_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(
      `AGENT_CHECKLIST_PORT must be an integer between 1 and 65535, got: ${raw}`,
    );
  }
  return n;
}