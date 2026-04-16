export function createBroadcaster() {
    const clients = new Set;
    return {
        add: (c) => clients.add(c),
        remove: (c) => clients.delete(c),
        broadcast: (msg) => {
            const data = JSON.stringify(msg);
            for (const client of clients) {
                try {
                    client.send(data);
                }
                catch {
                    clients.delete(client);
                }
            }
        },
        closeAll: () => {
            for (const c of clients) {
                try {
                    c.close?.();
                }
                catch {
                    /* ignore */
                }
            }
            clients.clear();
        },
        count: () => clients.size
    };
}
//# sourceMappingURL=broadcast.js.map