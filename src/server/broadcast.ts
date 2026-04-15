import type { WsMessage } from "../shared/types.js";

const clients = new Set<{ send: (data: string) => void }>();

export function addClient(client: { send: (data: string) => void }) {
  clients.add(client);
}

export function removeClient(client: { send: (data: string) => void }) {
  clients.delete(client);
}

export function broadcast(msg: WsMessage) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    try {
      client.send(data);
    } catch {
      clients.delete(client);
    }
  }
}
