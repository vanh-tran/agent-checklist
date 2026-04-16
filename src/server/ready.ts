export interface ReadyFlag {
    isReady(): boolean;
    markReady(): void;
}

export function createReadyFlag(): ReadyFlag {
    let ready = false;
    return {
        isReady: () => ready,
        markReady: () => {
            ready = true;
        }
    }
}