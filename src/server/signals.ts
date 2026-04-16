import type { ServerHandle } from "./server.js";

export function installShutdownHandlers(handle: ServerHandle): () => Promise<void> {
  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    handle.app.log.info?.(`received ${signal}; shutting down`);
    try {
      await handle.persistence.flush();
    } catch (err) {
      console.error("flush during shutdown failed", err);
    }
    handle.broadcaster.closeAll();
    try { await handle.app.close(); } catch { /* ignore */ }
    process.exit(0);
  }
  const sigterm = () => void shutdown("SIGTERM");
  const sigint = () => void shutdown("SIGINT");
  process.on("SIGTERM", sigterm);
  process.on("SIGINT", sigint);
  return async () => {
    process.off("SIGTERM", sigterm);
    process.off("SIGINT", sigint);
  };
}
