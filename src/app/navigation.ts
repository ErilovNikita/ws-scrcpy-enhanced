/** Parameters that select a client, device, or stream connection. */
const ROUTE_PARAMETERS = ['action', 'udid', 'player', 'ws', 'hostname', 'port', 'secure', 'useProxy', 'type'];

export function getRouteKey(hash: string): string {
    const params = new URLSearchParams(hash.replace(/^#!?/, ''));
    return JSON.stringify(ROUTE_PARAMETERS.map((name) => params.get(name)));
}

export function installHashNavigation(): void {
    const initialRoute = getRouteKey(window.location.hash);
    let navigating = false;
    window.addEventListener('hashchange', () => {
        // Client setup runs on load. Reload only when the selected client changes;
        // file-listing updates its `path` hash parameter while staying on the same screen.
        if (!navigating && getRouteKey(window.location.hash) !== initialRoute) {
            navigating = true;
            window.location.reload();
        }
    });
}
