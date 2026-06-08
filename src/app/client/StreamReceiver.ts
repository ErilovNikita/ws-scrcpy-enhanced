import { ManagerClient } from './ManagerClient';
import { ControlMessage } from '../controlMessage/ControlMessage';
import DeviceMessage from '../googDevice/DeviceMessage';
import VideoSettings from '../VideoSettings';
import ScreenInfo from '../ScreenInfo';
import Util from '../Util';
import { DisplayInfo } from '../DisplayInfo';
import { ParamsStream } from '../../types/ParamsStream';

const DEVICE_NAME_FIELD_LENGTH = 64;
const MAGIC_BYTES_INITIAL = Util.stringToUtf8ByteArray('scrcpy_initial');

export type ClientsStats = {
    deviceName: string;
    clientId: number;
};

export type DisplayCombinedInfo = {
    displayInfo: DisplayInfo;
    videoSettings?: VideoSettings;
    screenInfo?: ScreenInfo;
    connectionCount: number;
};

interface StreamReceiverEvents {
    video: ArrayBuffer;
    deviceMessage: DeviceMessage;
    displayInfo: DisplayCombinedInfo[];
    clientsStats: ClientsStats;
    encoders: string[];
    connected: void;
    disconnected: CloseEvent;
}

const TAG = '[StreamReceiver]';

export class StreamReceiver<P extends ParamsStream> extends ManagerClient<ParamsStream, StreamReceiverEvents> {
    private events: ControlMessage[] = [];
    private encodersSet: Set<string> = new Set<string>();
    private clientId = -1;
    private deviceName = '';
    private readonly displayInfoMap: Map<number, DisplayInfo> = new Map();
    private readonly connectionCountMap: Map<number, number> = new Map();
    private readonly screenInfoMap: Map<number, ScreenInfo> = new Map();
    private readonly videoSettingsMap: Map<number, VideoSettings> = new Map();
    private hasInitialInfo = false;
    private stopped = false;
    private reconnectAttempt = 0;
    private reconnectTimer?: number;
    private readonly onWindowFocus = (): void => {
        this.tryReconnect(true);
    };
    private readonly onVisibilityChange = (): void => {
        if (typeof document !== 'undefined' && document.hidden) {
            return;
        }
        this.tryReconnect(true);
    };
    private readonly onOnline = (): void => {
        this.tryReconnect(true);
    };

    constructor(params: P) {
        super(params);
        this.openNewConnection();
        if (this.ws) {
            this.ws.binaryType = 'arraybuffer';
        }
        this.bindAutoReconnect();
    }

    private bindAutoReconnect(): void {
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', this.onWindowFocus);
            window.addEventListener('online', this.onOnline);
        }
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this.onVisibilityChange);
        }
    }

    private unbindAutoReconnect(): void {
        if (typeof window !== 'undefined') {
            window.removeEventListener('focus', this.onWindowFocus);
            window.removeEventListener('online', this.onOnline);
        }
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.onVisibilityChange);
        }
        if (typeof this.reconnectTimer === 'number') {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }

    private scheduleReconnect(): void {
        if (this.stopped || this.destroyed) {
            return;
        }
        if (typeof window === 'undefined') {
            return;
        }
        if (typeof document !== 'undefined' && document.hidden) {
            return;
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return;
        }
        if (typeof this.reconnectTimer === 'number') {
            return;
        }
        const attempt = Math.min(this.reconnectAttempt, 6);
        const delay = 500 * Math.pow(2, attempt);
        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = undefined;
            this.tryReconnect(false);
        }, delay);
    }

    private tryReconnect(resetBackoff: boolean): void {
        if (this.stopped || this.destroyed) {
            return;
        }
        if (typeof document !== 'undefined' && document.hidden) {
            return;
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            this.scheduleReconnect();
            return;
        }
        if (this.hasConnection()) {
            if (resetBackoff) {
                this.reconnectAttempt = 0;
            }
            return;
        }
        if (resetBackoff) {
            this.reconnectAttempt = 0;
        } else {
            this.reconnectAttempt++;
        }
        this.openNewConnection();
        if (this.ws) {
            this.ws.binaryType = 'arraybuffer';
        }
    }

    private handleInitialInfo(data: ArrayBuffer): void {
        let offset = MAGIC_BYTES_INITIAL.length;
        let nameBytes = new Uint8Array(data, offset, DEVICE_NAME_FIELD_LENGTH);
        offset += DEVICE_NAME_FIELD_LENGTH;
        let rest: Buffer = Buffer.from(new Uint8Array(data, offset));
        const displaysCount = rest.readInt32BE(0);
        this.displayInfoMap.clear();
        this.connectionCountMap.clear();
        this.screenInfoMap.clear();
        this.videoSettingsMap.clear();
        rest = rest.slice(4);
        for (let i = 0; i < displaysCount; i++) {
            const displayInfoBuffer = rest.slice(0, DisplayInfo.BUFFER_LENGTH);
            const displayInfo = DisplayInfo.fromBuffer(displayInfoBuffer);
            const { displayId } = displayInfo;
            this.displayInfoMap.set(displayId, displayInfo);
            rest = rest.slice(DisplayInfo.BUFFER_LENGTH);
            this.connectionCountMap.set(displayId, rest.readInt32BE(0));
            rest = rest.slice(4);
            const screenInfoBytesCount = rest.readInt32BE(0);
            rest = rest.slice(4);
            if (screenInfoBytesCount) {
                this.screenInfoMap.set(displayId, ScreenInfo.fromBuffer(rest.slice(0, screenInfoBytesCount)));
                rest = rest.slice(screenInfoBytesCount);
            }
            const videoSettingsBytesCount = rest.readInt32BE(0);
            rest = rest.slice(4);
            if (videoSettingsBytesCount) {
                this.videoSettingsMap.set(displayId, VideoSettings.fromBuffer(rest.slice(0, videoSettingsBytesCount)));
                rest = rest.slice(videoSettingsBytesCount);
            }
        }
        this.encodersSet.clear();
        const encodersCount = rest.readInt32BE(0);
        rest = rest.slice(4);
        for (let i = 0; i < encodersCount; i++) {
            const nameLength = rest.readInt32BE(0);
            rest = rest.slice(4);
            const nameBytes = rest.slice(0, nameLength);
            rest = rest.slice(nameLength);
            const name = Util.utf8ByteArrayToString(nameBytes);
            this.encodersSet.add(name);
        }
        this.clientId = rest.readInt32BE(0);
        nameBytes = Util.filterTrailingZeroes(nameBytes);
        this.deviceName = Util.utf8ByteArrayToString(nameBytes);
        this.hasInitialInfo = true;
        this.triggerInitialInfoEvents();
    }

    private static EqualArrays(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
        if (a.length !== b.length) {
            return false;
        }
        for (let i = 0, l = a.length; i < l; i++) {
            if (a[i] !== b[i]) {
                return false;
            }
        }
        return true;
    }

    protected buildDirectWebSocketUrl(): URL {
        const localUrl = super.buildDirectWebSocketUrl();
        if (this.supportMultiplexing()) {
            return localUrl;
        }
        localUrl.searchParams.set('udid', this.params.udid);
        return localUrl;
    }

    protected onSocketClose(ev: CloseEvent): void {
        console.log(`${TAG}. WS closed: ${ev.reason}`);
        this.emit('disconnected', ev);
        this.scheduleReconnect();
    }

    protected onSocketMessage(event: MessageEvent): void {
        if (event.data instanceof ArrayBuffer) {
            // works only because MAGIC_BYTES_INITIAL and MAGIC_BYTES_MESSAGE have same length
            if (event.data.byteLength > MAGIC_BYTES_INITIAL.length) {
                const magicBytes = new Uint8Array(event.data, 0, MAGIC_BYTES_INITIAL.length);
                if (StreamReceiver.EqualArrays(magicBytes, MAGIC_BYTES_INITIAL)) {
                    this.handleInitialInfo(event.data);
                    return;
                }
                if (StreamReceiver.EqualArrays(magicBytes, DeviceMessage.MAGIC_BYTES_MESSAGE)) {
                    const message = DeviceMessage.fromBuffer(event.data);
                    this.emit('deviceMessage', message);
                    return;
                }
            }

            this.emit('video', new Uint8Array(event.data));
        }
    }

    protected onSocketOpen(): void {
        this.reconnectAttempt = 0;
        this.emit('connected', void 0);
        let e = this.events.shift();
        while (e) {
            this.sendEvent(e);
            e = this.events.shift();
        }
    }

    public sendEvent(event: ControlMessage): void {
        if (event.type === ControlMessage.TYPE_SET_SCREEN_POWER_MODE) {
            const payload = event.toBuffer();
            const mode = payload.length > 1 ? payload.readUInt8(1) : -1;
            console.info(
                `${TAG} Send TYPE_SET_SCREEN_POWER_MODE via WS: mode=${mode}, bytes=[${Array.from(payload).join(',')}]`,
            );
        }
        if (this.ws && this.ws.readyState === this.ws.OPEN) {
            this.ws.send(event.toBuffer());
        } else {
            this.events.push(event);
        }
    }

    public stop(): void {
        this.stopped = true;
        if (this.ws && this.ws.readyState === this.ws.OPEN) {
            this.ws.close();
        }
        this.events.length = 0;
    }

    public resume(): void {
        if (this.destroyed) {
            return;
        }
        this.stopped = false;
        this.tryReconnect(true);
    }

    public destroy(): void {
        this.unbindAutoReconnect();
        super.destroy();
    }

    public getEncoders(): string[] {
        return Array.from(this.encodersSet.values());
    }

    public getDeviceName(): string {
        return this.deviceName;
    }

    public triggerInitialInfoEvents(): void {
        if (this.hasInitialInfo) {
            const encoders = this.getEncoders();
            this.emit('encoders', encoders);
            const { clientId, deviceName } = this;
            this.emit('clientsStats', { clientId, deviceName });
            const infoArray: DisplayCombinedInfo[] = [];
            this.displayInfoMap.forEach((displayInfo: DisplayInfo, displayId: number) => {
                const connectionCount = this.connectionCountMap.get(displayId) || 0;
                infoArray.push({
                    displayInfo,
                    videoSettings: this.videoSettingsMap.get(displayId),
                    screenInfo: this.screenInfoMap.get(displayId),
                    connectionCount,
                });
            });
            this.emit('displayInfo', infoArray);
        }
    }

    public getDisplayInfo(displayId: number): DisplayInfo | undefined {
        return this.displayInfoMap.get(displayId);
    }
}
