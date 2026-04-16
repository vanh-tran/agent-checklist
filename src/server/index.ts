#!/usr/bin/env node
import { runCli } from "./cli.js";

runCli(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
