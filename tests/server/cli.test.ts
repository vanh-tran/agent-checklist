import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function runCli(
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn("node", ["--import", "tsx", "src/server/index.ts", ...args], {
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 10_000);
  return once(child, "exit").then(([code]) => {
    clearTimeout(timer);
    return { code: (code as number) ?? -1, stdout, stderr };
  });
}

async function waitForHealth(port: number, timeoutMs = 5000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://localhost:${port}/api/health`);
      if (r.ok) {
        const body = await r.json() as { service?: string };
        if (body.service === "agent-checklist") return true;
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test("start-background spawns a server, status reports healthy, stop shuts it down", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ac-cli-"));
  const stateFile = path.join(dir, "state.json");
  const port = 51800 + Math.floor(Math.random() * 100);
  const env = {
    AGENT_CHECKLIST_PORT: String(port),
    AGENT_CHECKLIST_STATE_FILE: stateFile,
  };

  const startRes = await runCli(["start-background"], { env, timeoutMs: 10_000 });
  assert.equal(startRes.code, 0, startRes.stderr);
  assert.equal(await waitForHealth(port), true);

  const status = await runCli(["status"], { env });
  assert.equal(status.code, 0);
  assert.match(status.stdout, /agent-checklist/);

  const stop = await runCli(["stop"], { env });
  assert.equal(stop.code, 0);

  rmSync(dir, { recursive: true });
});

test("ensure-running on a live server is a no-op exit 0", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ac-cli-"));
  const stateFile = path.join(dir, "state.json");
  const port = 51900 + Math.floor(Math.random() * 50);
  const env = {
    AGENT_CHECKLIST_PORT: String(port),
    AGENT_CHECKLIST_STATE_FILE: stateFile,
  };

  assert.equal((await runCli(["start-background"], { env })).code, 0);
  assert.equal(await waitForHealth(port), true);
  const res = await runCli(["ensure-running"], { env });
  assert.equal(res.code, 0);
  await runCli(["stop"], { env });
  rmSync(dir, { recursive: true });
});
