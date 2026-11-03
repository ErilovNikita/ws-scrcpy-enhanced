import '../../style/all-devices.css';
import SvgImage from '../ui/SvgImage';

export type OverviewStream = { key: string; name: string; href: string };
type StreamTile = {
    element: HTMLElement;
    frame: HTMLIFrameElement;
    title: HTMLAnchorElement;
    status: HTMLElement;
    href: string;
    timer?: ReturnType<typeof setTimeout>;
};

export const ALL_DEVICES_ACTION = 'all-devices';
export const OVERVIEW_STATUS_MESSAGE = 'overview-stream-status';

export function buildOverviewFrameUrl(href: string): string {
    const source = new URL(href, location.href);
    // Run every player on this origin; its existing ws/proxy parameters select the server.
    const url = new URL(location.pathname, location.origin);
    const params = new URLSearchParams(source.hash.replace(/^#!/, ''));
    params.set('embedded', 'overview');
    url.hash = `!${params.toString()}`;
    return url.toString();
}

export class AllDevicesView {
    public static instance?: AllDevicesView;
    private readonly trackers = new Map<string, OverviewStream[]>();
    private readonly tiles = new Map<string, StreamTile>();
    private readonly grid = document.createElement('div');
    private readonly empty = document.createElement('p');
    private readonly count = document.createElement('p');
    private readonly root = document.createElement('main');

    public static start(): void {
        if (!this.instance) {
            this.instance = new AllDevicesView();
        }
    }

    private constructor() {
        document.body.className = 'list overview';
        document.title = 'Все устройства — ws-scrcpy';
        this.root.className = 'all-devices-view';
        const header = document.createElement('header');
        header.className = 'all-devices-header';
        const heading = document.createElement('div');
        const back = document.createElement('a');
        back.className = 'all-devices-back';
        back.href = location.pathname;
        back.appendChild(SvgImage.create(SvgImage.Icon.ARROW_BACK));
        const backText = document.createElement('span');
        backText.textContent = 'К списку устройств';
        back.appendChild(backText);
        const title = document.createElement('h1');
        title.textContent = 'Все устройства';
        this.count.className = 'all-devices-count';
        this.count.setAttribute('role', 'status');
        this.count.textContent = 'Получаем список устройств…';
        heading.append(back, title, this.count);
        const note = document.createElement('span');
        note.className = 'all-devices-note';
        note.textContent = 'Живые экраны · без звука';
        header.append(heading, note);
        this.grid.className = 'all-devices-grid';
        this.empty.className = 'all-devices-empty';
        this.empty.textContent = 'Ожидаем подключения к серверу…';
        this.root.append(header, this.empty, this.grid);
        document.body.appendChild(this.root);
        window.addEventListener('message', this.onStreamStatus);
        window.addEventListener('pagehide', () => this.dispose(), { once: true });
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) {
                // Recreate streams when returning from the browser's back/forward cache.
                window.location.reload();
            }
        });
    }

    public syncTracker(id: string, block: Element): void {
        const streams: OverviewStream[] = [];
        block.querySelectorAll<HTMLAnchorElement>('.device.active .device-stream-link').forEach((link) => {
            const params = new URLSearchParams(new URL(link.href).hash.replace(/^#!/, ''));
            if (params.get('action') !== 'stream') {
                return;
            }
            streams.push({
                key: `${params.get('udid')}::${params.get('ws')}`,
                name:
                    link.closest('.device')?.querySelector('.device-name')?.textContent?.trim() ||
                    params.get('udid') ||
                    'Android',
                href: link.href,
            });
        });
        this.updateTracker(id, streams);
    }

    public updateTracker(id: string, streams: OverviewStream[]): void {
        this.trackers.set(id, streams);
        this.render();
    }

    public removeTracker(id: string): void {
        this.trackers.delete(id);
        this.render();
    }

    private render(): void {
        const streams = new Map<string, OverviewStream>();
        this.trackers.forEach((items) => items.forEach((item) => streams.set(item.key, item)));
        this.tiles.forEach((tile, key) => {
            if (!streams.has(key)) {
                clearTimeout(tile.timer);
                tile.element.remove();
                this.tiles.delete(key);
            }
        });
        streams.forEach((stream, key) => {
            let tile = this.tiles.get(key);
            if (!tile) {
                tile = this.createTile(stream);
                this.tiles.set(key, tile);
                this.grid.appendChild(tile.element);
            }
            tile.title.textContent = stream.name;
            tile.title.href = stream.href;
            tile.frame.title = `Экран ${stream.name}`;
            if (tile.href !== stream.href) {
                tile.href = stream.href;
                this.markConnecting(tile);
                tile.frame.src = buildOverviewFrameUrl(stream.href);
            }
        });
        this.count.textContent = `Доступно устройств: ${streams.size}`;
        this.empty.hidden = streams.size > 0;
        this.empty.textContent =
            'Нет доступных устройств. Подключите Android на главной странице — его экран появится здесь автоматически.';
    }

    private createTile(stream: OverviewStream): StreamTile {
        const element = document.createElement('section');
        element.className = 'all-devices-tile';
        const header = document.createElement('header');
        const title = document.createElement('a');
        title.className = 'all-devices-device-name';
        title.target = '_blank';
        title.rel = 'noopener noreferrer';
        title.title = 'Открыть устройство отдельно';
        const reload = document.createElement('button');
        reload.type = 'button';
        reload.className = 'all-devices-reload';
        reload.title = `Переподключить ${stream.name}`;
        reload.setAttribute('aria-label', reload.title);
        reload.appendChild(SvgImage.create(SvgImage.Icon.REFRESH));
        const frame = document.createElement('iframe');
        frame.className = 'all-devices-frame';
        frame.setAttribute('loading', 'eager');
        frame.tabIndex = -1;
        const status = document.createElement('span');
        status.className = 'all-devices-stream-status';
        status.textContent = 'Подключение…';
        const tile: StreamTile = { element, title, frame, status, href: '' };
        reload.addEventListener('click', () => {
            this.markConnecting(tile);
            frame.src = buildOverviewFrameUrl(title.href);
        });
        header.append(title, reload);
        element.append(header, frame, status);
        return tile;
    }

    private markConnecting(tile: StreamTile): void {
        clearTimeout(tile.timer);
        tile.status.textContent = 'Подключение…';
        tile.status.className = 'all-devices-stream-status';
        tile.timer = setTimeout(() => {
            tile.status.textContent = 'Нет видеосигнала · попробуйте переподключить';
            tile.status.className = 'all-devices-stream-status is-offline';
        }, 20000);
    }

    private onStreamStatus = (event: MessageEvent): void => {
        if (event.origin !== location.origin || event.data?.type !== OVERVIEW_STATUS_MESSAGE) {
            return;
        }
        this.tiles.forEach((tile) => {
            if (event.source !== tile.frame.contentWindow) {
                return;
            }
            const { width, height } = event.data;
            if (
                typeof width === 'number' &&
                typeof height === 'number' &&
                Number.isFinite(width) &&
                Number.isFinite(height) &&
                width > 0 &&
                height > 0
            ) {
                tile.frame.style.aspectRatio = `${width} / ${height}`;
            }
            if (event.data.status !== 'live' && event.data.status !== 'offline') {
                return;
            }
            clearTimeout(tile.timer);
            const live = event.data.status === 'live';
            tile.status.textContent = live ? 'В эфире' : 'Нет сигнала · переподключение…';
            tile.status.className = `all-devices-stream-status${live ? ' is-live' : ' is-offline'}`;
        });
    };

    public dispose(): void {
        window.removeEventListener('message', this.onStreamStatus);
        this.tiles.forEach((tile) => {
            clearTimeout(tile.timer);
            tile.element.remove();
        });
        this.tiles.clear();
        this.trackers.clear();
        this.root.remove();
        AllDevicesView.instance = undefined;
    }
}
