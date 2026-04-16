import { Command } from "commander";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPort } from "../shared/port.js";
import { startServer } from "./server.js";
import { installShutdownHandlers } from "./signals.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  const pkgPath = path.resolve(__dirname, "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
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

  return program;
}

export async function runCli(argv: readonly string[]): Promise<void> {
  await buildCli().parseAsync(argv as string[]);
}
