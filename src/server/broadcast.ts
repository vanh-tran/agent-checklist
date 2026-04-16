import type { WsMessage } from "../shared/types.js";

export interface WsClient {
  send(data: string): void;
}

export interface Broadcaster {
  add(client: WsClient): void;
  remove(client: WsClient): void;
  broadcast(msg: WsMessage): void;
  closeAll(): void;
  count(): number;
}

export function createBroadcaster(): Broadcaster {
  const clients = new Set<WsClient>;

  return {
    add: (c) => clients.add(c),
    remove: (c) => clients.delete(c),
    broadcast: (msg) => {
      const data = JSON.stringify(msg);
      for (const client of clients) {
        try {
          client.send(data);
        } catch {
          clients.delete(client);
        }
      }
    },
    closeAll: () => {
      for (const c of clients) {
        try {
          (c as WsClient & { close?: () => void }).close?.();
        } catch {
          /* ignore */
        }
      }
      clients.clear();
    },
    count: () => clients.size
  }
}
