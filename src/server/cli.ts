import { Command } from "commander";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPort } from "../shared/port.js";
import type { HealthResponse } from "../shared/types.js";
import { startServer } from "./server.js";
import { installShutdownHandlers } from "./signals.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  const pkgPath = path.resolve(__dirname, "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

async function probeHealth(port: number, timeoutMs = 2000): Promise<HealthResponse | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`http://localhost:${port}/api/health`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const body = (await r.json()) as HealthResponse;
    return body.service === "agent-checklist" ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function probeReady(port: number, timeoutMs = 1500): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`http://localhost:${port}/api/ready`, { signal: ctrl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function waitForReady(port: number, overallMs = 5000): Promise<boolean> {
  const until = Date.now() + overallMs;
  while (Date.now() < until) {
    if (await probeReady(port, 500)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function spawnDetached(): Promise<void> {
  // Detect whether we're running via tsx (dev) or from compiled JS (dist).
  // import.meta.url for this file ends in .ts when running via tsx.
  const thisFile = fileURLToPath(import.meta.url);
  const isCompiled = thisFile.endsWith(".js");
  const command = process.execPath;
  const args = isCompiled
    ? [path.resolve(__dirname, "./index.js"), "start"]
    : ["--import", "tsx", path.resolve(__dirname, "./index.ts"), "start"];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

export function buildCli(): Command {
  const program = new Command();
  program
    .name("agent-checklist")
    .description("Local MCP server + dashboard for coding-agent checklists.")
    .version(readVersion());

  program
    .command("start")
    .description("Start the server in the foreground (Ctrl+C to stop).")
    .action(async () => {
      const port = readPort();
      const handle = await startServer({ port, version: readVersion() });
      installShutdownHandlers(handle);
      console.log(`agent-checklist listening on http://localhost:${port}`);
      console.log(`  dashboard: http://localhost:${port}/`);
      console.log(`  MCP:       http://localhost:${port}/mcp`);
    });

  program
    .command("start-background")
    .description("Fork the server into the background; poll /api/ready before exiting.")
    .action(async () => {
      const port = readPort();
      if (await probeHealth(port)) {
        console.log(`already running on :${port}`);
        process.exit(0);
      }
      await spawnDetached();
      if (!(await waitForReady(port))) {
        console.error(`agent-checklist did not become ready on :${port} within 5s`);
        process.exit(1);
      }
      console.log(`agent-checklist ready on :${port}`);
      process.exit(0);
    });

  program
    .command("ensure-running")
    .description("Probe /api/health; if not alive or wrong version, (re)start. Idempotent.")
    .action(async () => {
      const port = readPort();
      const myVersion = readVersion();
      const backoffs = [200, 500, 1000];

      // Check if the running server is the right version. If not, kill it so
      // we can start the correct one (handles the dev-plugin-vs-stable race).
      const existing = await probeHealth(port);
      if (existing && existing.version !== myVersion) {
        try { process.kill(existing.pid, "SIGTERM"); } catch { /* already gone */ }
        // Give it a moment to release the port.
        await new Promise((r) => setTimeout(r, 500));
      } else if (existing) {
        process.exit(0);
      }

      for (let attempt = 0; attempt <= backoffs.length; attempt++) {
        const h = await probeHealth(port);
        if (h && h.version === myVersion) { process.exit(0); }
        if (attempt === 0) {
          await spawnDetached();
        }
        if (attempt < backoffs.length) {
          await new Promise((r) => setTimeout(r, backoffs[attempt]!));
        }
      }
      console.error(`agent-checklist could not be reached or started on :${port}`);
      process.exit(1);
    });

  program
    .command("status")
    .description("Probe /api/health and print the result.")
    .action(async () => {
      const port = readPort();
      const h = await probeHealth(port);
      if (!h) {
        console.log(`not running on :${port}`);
        process.exit(1);
      }
      console.log(`agent-checklist v${h.version} running on :${port} (pid ${h.pid}, started ${h.startedAt})`);
      process.exit(0);
    });

  program
    .command("stop")
    .description("Send SIGTERM to the running server.")
    .action(async () => {
      const port = readPort();
      const h = await probeHealth(port);
      if (!h) {
        console.error(`not running on :${port}`);
        process.exit(1);
      }
      try {
        process.kill(h.pid, "SIGTERM");
      } catch (err) {
        console.error(`failed to signal pid ${h.pid}: ${(err as Error).message}`);
        process.exit(1);
      }
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        if (!(await probeHealth(port, 500))) {
          console.log(`stopped (was pid ${h.pid})`);
          process.exit(0);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      console.error(`pid ${h.pid} did not exit within 5s; you may need to kill -9`);
      process.exit(1);
    });

  return program;
}

export async function runCli(argv: readonly string[]): Promise<void> {
  await buildCli().parseAsync(argv as string[]);
}
