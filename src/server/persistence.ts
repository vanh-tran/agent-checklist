import { promises as fs } from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION, type BoardState } from "../shared/types";

export interface PersistenceOptions {
    filePath: string;
    debounceMs?: number;
}

export interface Persistence {
    load(): Promise<BoardState>;
    schedule(state: BoardState): void;
    flush(): Promise<void>;
  }

  const EMPTY_STATE: BoardState = { schemaVersion: SCHEMA_VERSION, agents: {} };

export function createPersistence(opts: PersistenceOptions): Persistence {
    const debounceMs = opts.debounceMs ?? 200;
    let pending: BoardState | null = null;
    let timer: NodeJS.Timeout | null = null;
    let inflight: Promise<void> | null = null;

    async function writeNow(state: BoardState): Promise<void> {
        await fs.mkdir(path.dirname(opts.filePath), { recursive: true });
        const tmp = `${opts.filePath}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
        await fs.rename(tmp, opts.filePath);
    }

    async function doFlush(): Promise<void> {
        if (!pending) return;
        const toWrite = pending;
        pending = null;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        try {
          await writeNow(toWrite);
        } catch (err) {
          console.error("persistence: write failed; keeping in-memory state", err);
        }
      }

      return {
        async load(): Promise<BoardState> {
          let raw: string;
          try {
            raw = await fs.readFile(opts.filePath, "utf8");
          } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
              return structuredClone(EMPTY_STATE);
            }
            throw err;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch (err) {
            throw new Error(`state.json is not valid JSON: ${(err as Error).message}`);
          }
          return migrate(parsed);
        },
    
        schedule(state: BoardState): void {
          pending = state;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            inflight = doFlush();
          }, debounceMs);
        },
    
        async flush(): Promise<void> {
          if (inflight) await inflight;
          await doFlush();
        },
      };
    
}

function migrate(input: unknown): BoardState {
  if (!input || typeof input !== "object") return structuredClone(EMPTY_STATE);
  const obj = input as { schemaVersion?: number; agents?: unknown };
  const version = obj.schemaVersion;
  if (version === undefined) {
    return {
      schemaVersion: SCHEMA_VERSION,
      agents: (obj.agents as BoardState["agents"]) ?? {},
    };
  }
  if (version === SCHEMA_VERSION) return obj as BoardState;
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schema version ${version} (this binary supports <= ${SCHEMA_VERSION}). Upgrade agent-checklist.`,
    );
  }
  throw new Error(`Unknown schema version ${version}`);
}