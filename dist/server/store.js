import { SCHEMA_VERSION, } from "../shared/types.js";
export function createStore(initial) {
    const state = initial ?? { schemaVersion: SCHEMA_VERSION, agents: {} };
    function now() {
        return new Date().toISOString();
    }
    function makeTask(agentId, seq, label, ts) {
        return {
            id: `${agentId}-t${seq}`,
            label,
            status: "pending",
            updatedAt: ts,
        };
    }
    function registerAgent(input) {
        const existing = state.agents[input.agentId];
        if (existing) {
            if (existing.name !== input.name) {
                throw new Error(`Agent ID "${input.agentId}" already in use with a different name ("${existing.name}"). Use the existing name or choose a new ID.`);
            }
            existing.connectionStatus = "connected";
            existing.lastActivityAt = now();
            return {
                agent: existing,
                taskIds: existing.tasks.map((t) => t.id),
                reRegistered: true,
            };
        }
        const ts = now();
        const tasks = input.tasks.map((label, i) => makeTask(input.agentId, i, label, ts));
        const agent = {
            id: input.agentId,
            name: input.name,
            tasks,
            nextTaskSeq: tasks.length,
            source: "live",
            connectionStatus: "connected",
            startedAt: ts,
            lastActivityAt: ts,
        };
        state.agents[input.agentId] = agent;
        return { agent, taskIds: tasks.map((t) => t.id), reRegistered: false };
    }
    function markAllDisconnected() {
        for (const a of Object.values(state.agents)) {
            a.connectionStatus = "disconnected";
        }
    }
    function requireAgent(agentId) {
        const a = state.agents[agentId];
        if (!a)
            throw new Error(`Agent "${agentId}" not found.`);
        return a;
    }
    function updateTask(input) {
        const agent = requireAgent(input.agentId);
        const task = agent.tasks.find((t) => t.id === input.taskId);
        if (!task)
            throw new Error(`Task "${input.taskId}" not found on agent "${input.agentId}".`);
        const superseded = [];
        if (input.status === "in_progress") {
            for (const t of agent.tasks) {
                if (t.id !== task.id && t.status === "in_progress") {
                    t.status = "pending";
                    t.updatedAt = now();
                    superseded.push(t.id);
                }
            }
        }
        task.status = input.status;
        if (Object.prototype.hasOwnProperty.call(input, "note")) {
            // caller explicitly passed note (possibly "")
            task.note = input.note === "" ? undefined : input.note;
        }
        task.updatedAt = now();
        agent.connectionStatus = "connected";
        agent.lastActivityAt = task.updatedAt;
        return { agent, task, supersededTaskIds: superseded };
    }
    function addTasks(input) {
        const agent = requireAgent(input.agentId);
        const ts = now();
        const created = input.tasks.map((label) => {
            const t = makeTask(agent.id, agent.nextTaskSeq, label, ts);
            agent.nextTaskSeq += 1;
            return t;
        });
        if (input.afterTaskId) {
            const idx = agent.tasks.findIndex((t) => t.id === input.afterTaskId);
            if (idx < 0)
                throw new Error(`Task "${input.afterTaskId}" not found on agent "${input.agentId}".`);
            agent.tasks.splice(idx + 1, 0, ...created);
        }
        else {
            agent.tasks.push(...created);
        }
        agent.connectionStatus = "connected";
        agent.lastActivityAt = ts;
        return { agent, taskIds: created.map((t) => t.id) };
    }
    function removeTask(input) {
        const agent = requireAgent(input.agentId);
        const idx = agent.tasks.findIndex((t) => t.id === input.taskId);
        if (idx < 0)
            throw new Error(`Task "${input.taskId}" not found on agent "${input.agentId}".`);
        const task = agent.tasks[idx];
        if (task.status === "in_progress") {
            throw new Error(`Cannot remove a task in progress. Mark it "pending" or "completed" first.`);
        }
        agent.tasks.splice(idx, 1);
        agent.connectionStatus = "connected";
        agent.lastActivityAt = now();
        return { agent };
    }
    function reorderTasks(input) {
        const agent = requireAgent(input.agentId);
        const current = new Set(agent.tasks.map((t) => t.id));
        const next = new Set(input.taskIds);
        if (current.size !== next.size || [...current].some((id) => !next.has(id))) {
            throw new Error(`Reorder list must contain exactly the current task IDs (expected ${[...current].join(", ")}).`);
        }
        const byId = new Map(agent.tasks.map((t) => [t.id, t]));
        agent.tasks = input.taskIds.map((id) => byId.get(id));
        agent.connectionStatus = "connected";
        agent.lastActivityAt = now();
        return { agent };
    }
    function renameTask(input) {
        const agent = requireAgent(input.agentId);
        const task = agent.tasks.find((t) => t.id === input.taskId);
        if (!task)
            throw new Error(`Task "${input.taskId}" not found on agent "${input.agentId}".`);
        task.label = input.label;
        task.updatedAt = now();
        agent.connectionStatus = "connected";
        agent.lastActivityAt = task.updatedAt;
        return { agent, task };
    }
    function removeAgent(input) {
        if (!state.agents[input.agentId])
            return false;
        delete state.agents[input.agentId];
        return true;
    }
    function clearAll() {
        state.agents = {};
    }
    function applyRestartRecovery() {
        for (const agent of Object.values(state.agents)) {
            agent.connectionStatus = "disconnected";
            for (const t of agent.tasks) {
                if (t.status === "in_progress") {
                    t.status = "pending";
                    if (!t.note)
                        t.note = "server restarted";
                    t.updatedAt = now();
                }
            }
        }
    }
    return {
        getState: () => state,
        registerAgent,
        updateTask,
        addTasks,
        removeTask,
        reorderTasks,
        renameTask,
        removeAgent,
        clearAll,
        applyRestartRecovery,
        markAllDisconnected,
        now,
    };
}
//# sourceMappingURL=store.js.map