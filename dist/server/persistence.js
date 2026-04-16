import { promises as fs } from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION } from "../shared/types";
const EMPTY_STATE = { schemaVersion: SCHEMA_VERSION, agents: {} };
export function createPersistence(opts) {
    const debounceMs = opts.debounceMs ?? 200;
    let pending = null;
    let timer = null;
    let inflight = null;
    async function writeNow(state) {
        await fs.mkdir(path.dirname(opts.filePath), { recursive: true });
        const tmp = `${opts.filePath}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
        await fs.rename(tmp, opts.filePath);
    }
    async function doFlush() {
        if (!pending)
            return;
        const toWrite = pending;
        pending = null;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        try {
            await writeNow(toWrite);
        }
        catch (err) {
            console.error("persistence: write failed; keeping in-memory state", err);
        }
    }
    return {
        async load() {
            let raw;
            try {
                raw = await fs.readFile(opts.filePath, "utf8");
            }
            catch (err) {
                if (err.code === "ENOENT") {
                    return structuredClone(EMPTY_STATE);
                }
                throw err;
            }
            let parsed;
            try {
                parsed = JSON.parse(raw);
            }
            catch (err) {
                throw new Error(`state.json is not valid JSON: ${err.message}`);
            }
            return migrate(parsed);
        },
        schedule(state) {
            pending = state;
            if (timer)
                clearTimeout(timer);
            timer = setTimeout(() => {
                inflight = doFlush();
            }, debounceMs);
        },
        async flush() {
            if (inflight)
                await inflight;
            await doFlush();
        },
    };
}
function migrate(input) {
    if (!input || typeof input !== "object")
        return structuredClone(EMPTY_STATE);
    const obj = input;
    const version = obj.schemaVersion;
    if (version === undefined) {
        return {
            schemaVersion: SCHEMA_VERSION,
            agents: obj.agents ?? {},
        };
    }
    if (version === SCHEMA_VERSION)
        return obj;
    if (version > SCHEMA_VERSION) {
        throw new Error(`Unsupported schema version ${version} (this binary supports <= ${SCHEMA_VERSION}). Upgrade agent-checklist.`);
    }
    throw new Error(`Unknown schema version ${version}`);
}
//# sourceMappingURL=persistence.js.map