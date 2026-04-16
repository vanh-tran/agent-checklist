export function createReadyFlag() {
    let ready = false;
    return {
        isReady: () => ready,
        markReady: () => {
            ready = true;
        }
    };
}
//# sourceMappingURL=ready.js.map