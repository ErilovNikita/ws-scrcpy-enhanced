import { BaseClient } from '../../client/BaseClient';
import { ParamsStreamScrcpy } from '../../../types/ParamsStreamScrcpy';
import { GoogMoreBox } from '../toolbox/GoogMoreBox';
import { GoogToolBox } from '../toolbox/GoogToolBox';
import VideoSettings from '../../VideoSettings';
import Size from '../../Size';
import { ControlMessage } from '../../controlMessage/ControlMessage';
import { ClientsStats, DisplayCombinedInfo } from '../../client/StreamReceiver';
import { CommandControlMessage } from '../../controlMessage/CommandControlMessage';
import Util from '../../Util';
import FilePushHandler from '../filePush/FilePushHandler';
import DragAndPushLogger from '../DragAndPushLogger';
import { KeyEventListener, KeyInputHandler } from '../KeyInputHandler';
import { KeyCodeControlMessage } from '../../controlMessage/KeyCodeControlMessage';
import { BasePlayer, PlayerClass } from '../../player/BasePlayer';
import GoogDeviceDescriptor from '../../../types/GoogDeviceDescriptor';
import { ConfigureScrcpy } from './ConfigureScrcpy';
import { DeviceTracker } from './DeviceTracker';
import { ControlCenterCommand } from '../../../common/ControlCenterCommand';
import { html } from '../../ui/HtmlTag';
import {
    FeaturedInteractionHandler,
    InteractionHandlerListener,
} from '../../interactionHandler/FeaturedInteractionHandler';
import DeviceMessage from '../DeviceMessage';
import { DisplayInfo } from '../../DisplayInfo';
import { Attribute } from '../../Attribute';
import { HostTracker } from '../../client/HostTracker';
import { ACTION } from '../../../common/Action';
import { StreamReceiverScrcpy } from './StreamReceiverScrcpy';
import { ParamsDeviceTracker } from '../../../types/ParamsDeviceTracker';
import { ScrcpyFilePushStream } from '../filePush/ScrcpyFilePushStream';
import { ScrcpyAudioController, ScrcpyAudioFrameMode, ScrcpyAudioOptions } from '../../audio/ScrcpyAudioController';

type StartParams = {
    udid: string;
    playerName?: string;
    player?: BasePlayer;
    fitToScreen?: boolean;
    videoSettings?: VideoSettings;
};

type SavedVideoSettingsPayload = {
    bitrate?: number;
    maxFps?: number;
    iFrameInterval?: number;
    bounds?: {
        width?: number;
        height?: number;
    };
};

const TAG = '[StreamClientScrcpy]';
const VIDEO_META_LENGTH = 12;

function readU32BE(data: Uint8Array, offset: number): number {
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, false);
}

function readI64BE(data: Uint8Array, offset: number): number {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const hi = view.getInt32(offset, false);
    const lo = view.getUint32(offset + 4, false);
    if (hi >= 0) {
        return hi * 4294967296 + lo;
    }
    const hiU = (~hi) >>> 0;
    const loU = (~lo) >>> 0;
    return -((hiU * 4294967296 + loU) + 1);
}

export class StreamClientScrcpy
    extends BaseClient<ParamsStreamScrcpy, never>
    implements KeyEventListener, InteractionHandlerListener
{
    public static ACTION = 'stream';
    private static players: Map<string, PlayerClass> = new Map<string, PlayerClass>();
    private static savedVideoSettingsKeyPrefix = 'ws-scrcpy:saved-video-settings:v1';

    private controlButtons?: HTMLElement;
    private deviceName = '';
    private clientId = -1;
    private clientsCount = -1;
    private joinedStream = false;
    private touchHandler?: FeaturedInteractionHandler;
    private moreBox?: GoogMoreBox;
    private player?: BasePlayer;
    private filePushHandler?: FilePushHandler;
    private fitToScreen?: boolean;
    private readonly streamReceiver: StreamReceiverScrcpy;
    private videoContainer?: HTMLElement;
    private resizeObserver?: ResizeObserver;
    private viewportFitRaf?: number;
    private applyingViewportFit = false;
    private initialAutoFitApplied = false;
    private audioController?: ScrcpyAudioController;
    private audioEnabled = false;
    private audioOptions: ScrcpyAudioOptions = { frameMode: 'combined', channels: 1, bitrate: 64_000 };
    private pendingVideoPtsUs = 0;
    private pendingVideoPacketSize = 0;
    private uiStateBinding?: { restore: () => void; dispose: () => void };
    private uiStateRestored = false;
    private savedVideoSettings?: SavedVideoSettingsPayload;
    private savedVideoSettingsApplied = false;
    private stopping = false;
    private filePickerActive = false;
    private syncAudioConnection(connected: boolean): void {
        if (!this.audioEnabled || !ScrcpyAudioController.isSupported() || !this.player) {
            return;
        }
        if (!this.audioController) {
            this.audioController = new ScrcpyAudioController(this.params);
        }
        if (connected) {
            this.audioController.setOptions(this.audioOptions);
        }
        this.audioController.setEnabled(connected);
    }

    public static registerPlayer(playerClass: PlayerClass): void {
        if (playerClass.isSupported()) {
            this.players.set(playerClass.playerFullName, playerClass);
        }
    }

    public static getPlayers(): PlayerClass[] {
        return Array.from(this.players.values());
    }

    private static getPlayerClass(playerName: string): PlayerClass | undefined {
        let playerClass: PlayerClass | undefined;
        for (const value of StreamClientScrcpy.players.values()) {
            if (value.playerFullName === playerName || value.playerCodeName === playerName) {
                playerClass = value;
            }
        }
        return playerClass;
    }

    public static createPlayer(playerName: string, udid: string, displayInfo?: DisplayInfo): BasePlayer | undefined {
        const playerClass = this.getPlayerClass(playerName);
        if (!playerClass) {
            return;
        }
        return new playerClass(udid, displayInfo);
    }

    public static getFitToScreen(playerName: string, udid: string, displayInfo?: DisplayInfo): boolean {
        const playerClass = this.getPlayerClass(playerName);
        if (!playerClass) {
            return false;
        }
        return playerClass.getFitToScreenStatus(udid, displayInfo);
    }

    public static start(
        query: URLSearchParams | ParamsStreamScrcpy,
        streamReceiver?: StreamReceiverScrcpy,
        player?: BasePlayer,
        fitToScreen?: boolean,
        videoSettings?: VideoSettings,
    ): StreamClientScrcpy {
        if (query instanceof URLSearchParams) {
            const params = StreamClientScrcpy.parseParameters(query);
            return new StreamClientScrcpy(params, streamReceiver, player, fitToScreen, videoSettings);
        } else {
            return new StreamClientScrcpy(query, streamReceiver, player, fitToScreen, videoSettings);
        }
    }

    private static createVideoSettingsWithBounds(old: VideoSettings, newBounds: Size): VideoSettings {
        return new VideoSettings({
            crop: old.crop,
            bitrate: old.bitrate,
            bounds: newBounds,
            maxFps: old.maxFps,
            iFrameInterval: old.iFrameInterval,
            sendFrameMeta: old.sendFrameMeta,
            lockedVideoOrientation: old.lockedVideoOrientation,
            displayId: old.displayId,
            codecOptions: old.codecOptions,
            encoderName: old.encoderName,
        });
    }

    protected constructor(
        params: ParamsStreamScrcpy,
        streamReceiver?: StreamReceiverScrcpy,
        player?: BasePlayer,
        fitToScreen?: boolean,
        videoSettings?: VideoSettings,
    ) {
        super(params);
        if (streamReceiver) {
            this.streamReceiver = streamReceiver;
        } else {
            this.streamReceiver = new StreamReceiverScrcpy(this.params);
        }

        const { udid, player: playerName } = this.params;
        this.startStream({ udid, player, playerName, fitToScreen, videoSettings });
        this.setBodyClass('stream');
    }

    public static parseParameters(params: URLSearchParams): ParamsStreamScrcpy {
        const typedParams = super.parseParameters(params);
        const { action } = typedParams;
        if (action !== ACTION.STREAM_SCRCPY) {
            throw Error('Incorrect action');
        }
        return {
            ...typedParams,
            action,
            player: Util.parseString(params, 'player', true),
            udid: Util.parseString(params, 'udid', true),
            ws: Util.parseString(params, 'ws', true),
        };
    }

    public OnDeviceMessage = (message: DeviceMessage): void => {
        if (this.moreBox) {
            this.moreBox.OnDeviceMessage(message);
        }
    };

    public onVideo = (data: ArrayBuffer | Uint8Array): void => {
        if (!this.player) {
            return;
        }
        const STATE = BasePlayer.STATE;
        if (this.player.getState() === STATE.PAUSED) {
            this.player.play();
        }
        if (this.player.getState() === STATE.PLAYING) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            const sendFrameMeta = this.player.getVideoSettings().sendFrameMeta;
            if (sendFrameMeta) {
                if (this.pendingVideoPacketSize > 0) {
                    if (bytes.byteLength === this.pendingVideoPacketSize) {
                        const ptsUs = this.pendingVideoPtsUs;
                        this.pendingVideoPtsUs = 0;
                        this.pendingVideoPacketSize = 0;
                        this.player.pushFrame(bytes, ptsUs);
                        return;
                    }
                    this.pendingVideoPtsUs = 0;
                    this.pendingVideoPacketSize = 0;
                }
                if (bytes.byteLength === VIDEO_META_LENGTH) {
                    this.pendingVideoPtsUs = readI64BE(bytes, 0);
                    this.pendingVideoPacketSize = readU32BE(bytes, 8);
                    return;
                }
                if (bytes.byteLength > VIDEO_META_LENGTH) {
                    const ptsUs = readI64BE(bytes, 0);
                    const packetSize = readU32BE(bytes, 8);
                    if (packetSize > 0 && VIDEO_META_LENGTH + packetSize === bytes.byteLength) {
                        this.player.pushFrame(bytes.subarray(VIDEO_META_LENGTH, VIDEO_META_LENGTH + packetSize), ptsUs);
                        return;
                    }
                }
            }
            this.player.pushFrame(bytes);
        }
    };

    public onClientsStats = (stats: ClientsStats): void => {
        this.deviceName = stats.deviceName;
        this.clientId = stats.clientId;
        this.setTitle(`Stream ${this.deviceName}`);
    };

    public onDisplayInfo = (infoArray: DisplayCombinedInfo[]): void => {
        if (!this.player) {
            return;
        }
        let currentSettings = this.player.getVideoSettings();
        const displayId = currentSettings.displayId;
        const info = infoArray.find((value) => {
            return value.displayInfo.displayId === displayId;
        });
        if (!info) {
            return;
        }
        if (this.player.getState() === BasePlayer.STATE.PAUSED) {
            this.player.play();
        }
        const { videoSettings, screenInfo } = info;
        this.player.setDisplayInfo(info.displayInfo);
        if (typeof this.fitToScreen !== 'boolean') {
            this.fitToScreen = this.player.getFitToScreenStatus();
        }
        if (this.fitToScreen) {
            this.applyViewportFit();
        }
        if (!videoSettings || !screenInfo) {
            this.joinedStream = true;
            this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(currentSettings));
            return;
        }

        this.clientsCount = info.connectionCount;
        let min = VideoSettings.copy(videoSettings);
        const oldInfo = this.player.getScreenInfo();
        if (!screenInfo.equals(oldInfo)) {
            this.player.setScreenInfo(screenInfo);
            this.applyViewportFit();
        }
        this.tryRunInitialAutoFit(screenInfo);

        if (!videoSettings.equals(currentSettings)) {
            this.applyNewVideoSettings(videoSettings, false);
        }
        if (!oldInfo) {
            const bounds = currentSettings.bounds;
            const videoSize: Size = screenInfo.videoSize;
            const onlyOneClient = this.clientsCount === 0;
            const smallerThenCurrent = bounds && (bounds.width < videoSize.width || bounds.height < videoSize.height);
            if (onlyOneClient || smallerThenCurrent) {
                min = currentSettings;
            }
            const minBounds = currentSettings.bounds?.intersect(min.bounds);
            if (minBounds && !minBounds.equals(min.bounds)) {
                min = StreamClientScrcpy.createVideoSettingsWithBounds(min, minBounds);
            }
        }
        if (!min.equals(videoSettings) || !this.joinedStream) {
            this.joinedStream = true;
            this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(min));
        }
        this.restoreSavedVideoSettingsAfterAutoFit();
        this.restoreUiStateOnce();
    };

    public onDisconnected = (_ev: CloseEvent): void => {
        this.connectedHandled = false;
        this.syncAudioConnection(false);
        this.pendingVideoPtsUs = 0;
        this.pendingVideoPacketSize = 0;

        if (this.stopping) {
            this.streamReceiver.off('deviceMessage', this.OnDeviceMessage);
            this.streamReceiver.off('video', this.onVideo);
            this.streamReceiver.off('clientsStats', this.onClientsStats);
            this.streamReceiver.off('displayInfo', this.onDisplayInfo);
            this.streamReceiver.off('disconnected', this.onDisconnected);
            this.player?.off('video-view-resize', this.onPlayerViewResize);
            this.player?.off('input-video-resize', this.onInputVideoResize);

            window.removeEventListener('resize', this.onWindowResize);
            if (this.resizeObserver) {
                this.resizeObserver.disconnect();
                this.resizeObserver = undefined;
            }
            if (typeof this.viewportFitRaf === 'number') {
                cancelAnimationFrame(this.viewportFitRaf);
                this.viewportFitRaf = undefined;
            }

            this.filePushHandler?.release();
            this.filePushHandler = undefined;
            this.uiStateBinding?.dispose();
            this.uiStateBinding = undefined;
            this.uiStateRestored = false;
            this.savedVideoSettings = undefined;
            this.savedVideoSettingsApplied = false;
            this.touchHandler?.release();
            this.touchHandler = undefined;
            return;
        }

        if (this.filePickerActive) {
            return;
        }
        this.streamReceiver.resume();
    };

    public setAudioEnabled(enabled: boolean): void {
        if (!ScrcpyAudioController.isSupported() || !this.player) {
            return;
        }
        if (this.audioEnabled === enabled) {
            return;
        }
        this.audioEnabled = enabled;
        this.pendingVideoPtsUs = 0;
        this.pendingVideoPacketSize = 0;
        if (!this.audioController) {
            this.audioController = new ScrcpyAudioController(this.params);
        }
        if (enabled) {
            this.audioController.setOptions(this.audioOptions);
        }
        this.audioController.setEnabled(enabled);
    }

    public getAudioOptions(): ScrcpyAudioOptions {
        return { ...this.audioOptions };
    }

    public setAudioOptions(options: { frameMode?: ScrcpyAudioFrameMode; channels?: 1 | 2; bitrate?: number }): void {
        this.audioOptions = { ...this.audioOptions, ...options };
        if (!this.audioController) {
            this.audioController = new ScrcpyAudioController(this.params);
        }
        this.audioController.setOptions(this.audioOptions);
    }

    public startStream({ udid, player, playerName, videoSettings, fitToScreen }: StartParams): void {
        if (!udid) {
            throw Error(`Invalid udid value: "${udid}"`);
        }

        this.fitToScreen = fitToScreen;
        this.initialAutoFitApplied = false;
        if (!player) {
            if (typeof playerName !== 'string') {
                throw Error('Must provide BasePlayer instance or playerName');
            }
            let displayInfo: DisplayInfo | undefined;
            if (this.streamReceiver && videoSettings) {
                displayInfo = this.streamReceiver.getDisplayInfo(videoSettings.displayId);
            }
            const p = StreamClientScrcpy.createPlayer(playerName, udid, displayInfo);
            if (!p) {
                throw Error(`Unsupported player: "${playerName}"`);
            }
            if (typeof fitToScreen !== 'boolean') {
                fitToScreen = StreamClientScrcpy.getFitToScreen(playerName, udid, displayInfo);
            }
            player = p;
        }
        this.player = player;
        this.setTouchListeners(player);

        if (!videoSettings) {
            videoSettings = player.getVideoSettings();
        }
        this.savedVideoSettingsApplied = false;
        this.savedVideoSettings = StreamClientScrcpy.readSavedVideoSettings(player.getName(), udid, videoSettings.displayId);
        this.applyNewVideoSettings(videoSettings, false);

        const deviceView = document.createElement('div');
        deviceView.className = 'device-view';
        const stop = (ev?: string | Event) => {
            if (ev && ev instanceof Event && ev.type === 'error') {
                console.error(TAG, ev);
            }
            this.uiStateBinding?.dispose();
            this.uiStateBinding = undefined;
            this.uiStateRestored = false;
            let parent;
            parent = deviceView.parentElement;
            if (parent) {
                parent.removeChild(deviceView);
            }
            parent = moreBox.parentElement;
            if (parent) {
                parent.removeChild(moreBox);
            }
            this.stopping = true;
            this.streamReceiver.stop();
            if (this.player) {
                this.player.stop();
            }
        };

        const googMoreBox = (this.moreBox = new GoogMoreBox(udid, player, this));
        const moreBox = googMoreBox.getHolderElement();
        googMoreBox.setOnStop(stop);
        const googToolBox = GoogToolBox.createToolBox(udid, player, this, moreBox);
        this.controlButtons = googToolBox.getHolderElement();
        deviceView.appendChild(this.controlButtons);
        const video = document.createElement('div');
        video.className = 'video';
        this.videoContainer = video;
        deviceView.appendChild(video);
        deviceView.appendChild(moreBox);
        player.setParent(video);
        player.pause();

        document.body.appendChild(deviceView);
        this.uiStateBinding?.dispose();
        this.uiStateBinding = Util.bindFormStateToLocalStorage(deviceView, 'ws-scrcpy:ui-state:v1', {
            deferRestore: true,
            restoreMode: 'simulate',
        });
        this.uiStateRestored = false;
        window.addEventListener('resize', this.onWindowResize);
        player.on('video-view-resize', this.onPlayerViewResize);
        player.on('input-video-resize', this.onInputVideoResize);
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                this.scheduleViewportFit();
            });
            this.resizeObserver.observe(document.documentElement);
            this.resizeObserver.observe(this.controlButtons);
            this.resizeObserver.observe(video);
        }
        this.scheduleViewportFit();
        const element = player.getTouchableElement();
        const logger = new DragAndPushLogger(element);
        let lastDestinationDir = '/sdcard/Download';
        this.filePushHandler = new FilePushHandler(element, new ScrcpyFilePushStream(this.streamReceiver), {
            resolveDestinationDir: () => {
                const input = window.prompt(
                    'Upload destination directory (absolute path like /sdcard/Download). Leave empty or Cancel to use default /data/local/tmp',
                    lastDestinationDir,
                );
                if (input === null) {
                    return;
                }
                const trimmed = input.trim();
                if (!trimmed) {
                    return;
                }
                const normalized = trimmed.replace(/\\/g, '/');
                if (!normalized.startsWith('/')) {
                    return;
                }
                if (normalized.includes('\0')) {
                    return;
                }
                const withoutTrailingSlash = normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
                const segments = withoutTrailingSlash.split('/').filter(Boolean);
                if (segments.some((s) => s === '.' || s === '..')) {
                    return;
                }
                lastDestinationDir = withoutTrailingSlash;
                return withoutTrailingSlash;
            },
        });
        this.filePushHandler.addEventListener(logger);

        const streamReceiver = this.streamReceiver;
        streamReceiver.on('deviceMessage', this.OnDeviceMessage);
        streamReceiver.on('video', this.onVideo);
        streamReceiver.on('clientsStats', this.onClientsStats);
        streamReceiver.on('displayInfo', this.onDisplayInfo);
        streamReceiver.on('disconnected', this.onDisconnected);
        streamReceiver.on('connected', () => {
            this.onConnected();
        });
        if (streamReceiver.hasConnection()) {
            this.onConnected();
        }
        console.log(TAG, player.getName(), udid);
    }

    private restoreUiStateOnce(): void {
        if (this.uiStateRestored) {
            return;
        }
        if (!this.uiStateBinding) {
            return;
        }
        this.uiStateRestored = true;
        this.uiStateBinding.restore();
    }

    private connectedHandled = false;
    private onConnected(): void {
        if (this.connectedHandled) {
            return;
        }
        this.connectedHandled = true;
        this.syncAudioConnection(true);
        // Wait for real input stream resolution before running initial auto-fit.
    }

    public triggerScreenFit(): void {
        this.scheduleViewportFit();
        if (!this.player || !this.fitToScreen) {
            return;
        }
        const maxBounds = this.getMaxSize();
        if (!maxBounds) {
            return;
        }
        const currentSettings = this.player.getVideoSettings();
        if (currentSettings.bounds && currentSettings.bounds.equals(maxBounds)) {
            return;
        }
        const newSettings = StreamClientScrcpy.createVideoSettingsWithBounds(currentSettings, maxBounds);
        this.sendNewVideoSetting(newSettings);
    }

    public sendMessage(message: ControlMessage): void {
        this.streamReceiver.sendEvent(message);
    }

    public selectAndUploadFile(destinationDir = '/sdcard/Download'): void {
        if (!this.filePushHandler) {
            return;
        }
        this.filePickerActive = true;
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.style.display = 'none';
        document.body.appendChild(input);

        const cleanup = () => {
            this.filePickerActive = false;
            input.value = '';
            input.remove();
        };

        const onFocus = () => {
            window.removeEventListener('focus', onFocus);
            this.streamReceiver.resume();
            window.setTimeout(() => {
                if (!input.files || input.files.length === 0) {
                    cleanup();
                }
            }, 0);
        };
        window.addEventListener('focus', onFocus);

        input.addEventListener('change', () => {
            const files = input.files ? Array.from(input.files) : [];
            cleanup();
            if (!files.length) {
                return;
            }
            const push = () => {
                this.filePushHandler?.pushFiles(files, destinationDir);
            };
            if (this.streamReceiver.hasConnection()) {
                push();
                return;
            }
            this.streamReceiver.once('connected', push);
            this.streamReceiver.resume();
        });

        input.click();
    }

    public getDeviceName(): string {
        return this.deviceName;
    }

    public setHandleKeyboardEvents(enabled: boolean): void {
        if (enabled) {
            KeyInputHandler.addEventListener(this);
        } else {
            KeyInputHandler.removeEventListener(this);
        }
    }

    public onKeyEvent(event: KeyCodeControlMessage): void {
        this.sendMessage(event);
    }

    public sendNewVideoSetting(videoSettings: VideoSettings): void {
        this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(videoSettings));
    }

    public getClientId(): number {
        return this.clientId;
    }

    public getControlButtonsElement(): HTMLElement | undefined {
        return this.controlButtons;
    }

    public getClientsCount(): number {
        return this.clientsCount;
    }

    public getMaxSize(): Size | undefined {
        if (!this.controlButtons || !this.videoContainer) {
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        const viewportWidth =
            document.documentElement.clientWidth || document.body.clientWidth || window.innerWidth;
        const viewportHeight =
            document.documentElement.clientHeight || document.body.clientHeight || window.innerHeight;
        const width = ((viewportWidth - this.controlButtons.clientWidth) * dpr) & ~15;
        const height = (viewportHeight * dpr) & ~15;
        return new Size(width, height);
    }

    private setTouchListeners(player: BasePlayer): void {
        if (this.touchHandler) {
            return;
        }
        this.touchHandler = new FeaturedInteractionHandler(player, this);
    }

    private applyNewVideoSettings(videoSettings: VideoSettings, saveToStorage: boolean): void {
        if (this.player) {
            this.player.setVideoSettings(videoSettings, !!this.fitToScreen, saveToStorage);
            this.scheduleViewportFit();
        }
    }

    private onWindowResize = (): void => {
        this.scheduleViewportFit();
    };

    private onPlayerViewResize = (): void => {
        if (this.applyingViewportFit) {
            return;
        }
        this.scheduleViewportFit();
    };

    private onInputVideoResize = (): void => {
        this.tryRunInitialAutoFit();
    };

    private scheduleViewportFit(): void {
        if (typeof this.viewportFitRaf === 'number') {
            return;
        }
        this.viewportFitRaf = requestAnimationFrame(() => {
            this.viewportFitRaf = undefined;
            this.applyViewportFit();
        });
    };

    private applyViewportFit(): void {
        if (!this.player || !this.videoContainer) {
            return;
        }
        const screenInfo = this.player.getScreenInfo();
        if (!screenInfo) {
            return;
        }
        const { width: videoWidth, height: videoHeight } = screenInfo.videoSize;
        const maxSize = this.getMaxSize();
        if (!maxSize || maxSize.width <= 0 || maxSize.height <= 0 || videoWidth <= 0 || videoHeight <= 0) {
            this.player.setViewSize(videoWidth, videoHeight);
            return;
        }
        const scale = Math.min(maxSize.width / videoWidth, maxSize.height / videoHeight);
        const fittedWidth = Math.max(16, (Math.floor(videoWidth * scale) | 0) & ~15);
        const fittedHeight = Math.max(16, (Math.floor(videoHeight * scale) | 0) & ~15);
        this.applyingViewportFit = true;
        try {
            this.player.setViewSize(fittedWidth, fittedHeight);
        } finally {
            this.applyingViewportFit = false;
        }
    }

    private tryRunInitialAutoFit(screenInfo?: { videoSize: Size }): void {
        if (this.initialAutoFitApplied || !this.player) {
            return;
        }
        const info = screenInfo || this.player.getScreenInfo();
        if (!info) {
            return;
        }
        this.initialAutoFitApplied = true;
        this.scheduleViewportFit();
        const maxBounds = this.getMaxSize();
        if (!maxBounds) {
            return;
        }
        const currentSettings = this.player.getVideoSettings();
        if (currentSettings.bounds && currentSettings.bounds.equals(maxBounds)) {
            return;
        }
        const newSettings = StreamClientScrcpy.createVideoSettingsWithBounds(currentSettings, maxBounds);
        this.sendNewVideoSetting(newSettings);
    }

    private restoreSavedVideoSettingsAfterAutoFit(): void {
        if (this.savedVideoSettingsApplied || !this.savedVideoSettings || !this.player) {
            return;
        }
        if (!this.initialAutoFitApplied) {
            return;
        }
        this.savedVideoSettingsApplied = true;
        const merged = StreamClientScrcpy.mergeVideoSettingsWithSaved(this.player.getVideoSettings(), this.savedVideoSettings);
        this.sendNewVideoSetting(merged);
    }

    private static getSavedVideoSettingsKey(playerName: string, udid: string, displayId: number): string {
        return `${StreamClientScrcpy.savedVideoSettingsKeyPrefix}:${playerName}:${udid}:${displayId}`;
    }

    private static readSavedVideoSettings(
        playerName: string,
        udid: string,
        displayId: number,
    ): SavedVideoSettingsPayload | undefined {
        if (!window.localStorage) {
            return;
        }
        const key = StreamClientScrcpy.getSavedVideoSettingsKey(playerName, udid, displayId);
        const raw = window.localStorage.getItem(key);
        if (!raw) {
            return;
        }
        try {
            const parsed: any = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return;
            }
            return parsed as SavedVideoSettingsPayload;
        } catch (error: any) {
            return;
        }
    }

    private static mergeVideoSettingsWithSaved(current: VideoSettings, saved: SavedVideoSettingsPayload): VideoSettings {
        const toInt = (value: any): number | undefined => {
            const n = typeof value === 'number' ? value : typeof value === 'string' ? parseInt(value, 10) : NaN;
            return typeof n === 'number' && !isNaN(n) ? (n | 0) : undefined;
        };
        const bitrate = toInt(saved.bitrate);
        const maxFps = toInt(saved.maxFps);
        const iFrameInterval = toInt(saved.iFrameInterval);
        let bounds: Size | undefined;
        if (saved.bounds && typeof saved.bounds === 'object') {
            const width = toInt(saved.bounds.width);
            const height = toInt(saved.bounds.height);
            const w = (width || 0) & ~15;
            const h = (height || 0) & ~15;
            if (w > 0 && h > 0) {
                bounds = new Size(w, h);
            }
        }
        return new VideoSettings({
            bounds: bounds || current.bounds,
            bitrate: typeof bitrate === 'number' ? bitrate : current.bitrate,
            maxFps: typeof maxFps === 'number' ? maxFps : current.maxFps,
            iFrameInterval: typeof iFrameInterval === 'number' ? iFrameInterval : current.iFrameInterval,
            lockedVideoOrientation: current.lockedVideoOrientation,
            sendFrameMeta: current.sendFrameMeta,
            displayId: current.displayId,
            codecOptions: current.codecOptions,
            encoderName: current.encoderName,
            crop: current.crop,
        });
    }

    public static createEntryForDeviceList(
        descriptor: GoogDeviceDescriptor,
        blockClass: string,
        fullName: string,
        params: ParamsDeviceTracker,
    ): HTMLElement | DocumentFragment | undefined {
        const hasPid = descriptor.pid !== -1;
        if (hasPid) {
            const configureButtonId = `configure_${Util.escapeUdid(descriptor.udid)}`;
            const e = html`<div class="stream ${blockClass}">
                <button
                    ${Attribute.UDID}="${descriptor.udid}"
                    ${Attribute.COMMAND}="${ControlCenterCommand.CONFIGURE_STREAM}"
                    ${Attribute.FULL_NAME}="${fullName}"
                    ${Attribute.SECURE}="${params.secure}"
                    ${Attribute.HOSTNAME}="${params.hostname}"
                    ${Attribute.PORT}="${params.port}"
                    ${Attribute.USE_PROXY}="${params.useProxy}"
                    id="${configureButtonId}"
                    class="active action-button"
                >
                    Configure stream
                </button>
            </div>`;
            const a = e.content.getElementById(configureButtonId);
            a && (a.onclick = this.onConfigureStreamClick);
            return e.content;
        }
        return;
    }

    private static onConfigureStreamClick = (event: MouseEvent): void => {
        const button = event.currentTarget as HTMLAnchorElement;
        const udid = Util.parseStringEnv(button.getAttribute(Attribute.UDID) || '');
        const fullName = button.getAttribute(Attribute.FULL_NAME);
        const secure = Util.parseBooleanEnv(button.getAttribute(Attribute.SECURE) || undefined) || false;
        const hostname = Util.parseStringEnv(button.getAttribute(Attribute.HOSTNAME) || undefined) || '';
        const port = Util.parseIntEnv(button.getAttribute(Attribute.PORT) || undefined);
        const useProxy = Util.parseBooleanEnv(button.getAttribute(Attribute.USE_PROXY) || undefined);
        if (!udid) {
            throw Error(`Invalid udid value: "${udid}"`);
        }
        if (typeof port !== 'number') {
            throw Error(`Invalid port type: ${typeof port}`);
        }
        const tracker = DeviceTracker.getInstance({
            type: 'android',
            secure,
            hostname,
            port,
            useProxy,
        });
        const descriptor = tracker.getDescriptorByUdid(udid);
        if (!descriptor) {
            return;
        }
        event.preventDefault();
        const elements = document.getElementsByName(`${DeviceTracker.AttributePrefixInterfaceSelectFor}${fullName}`);
        if (!elements || !elements.length) {
            return;
        }
        const select = elements[0] as HTMLSelectElement;
        const optionElement = select.options[select.selectedIndex];
        const ws = optionElement.getAttribute(Attribute.URL);
        const name = optionElement.getAttribute(Attribute.NAME);
        if (!ws || !name) {
            return;
        }
        const options: ParamsStreamScrcpy = {
            udid,
            ws,
            player: '',
            action: ACTION.STREAM_SCRCPY,
            secure,
            hostname,
            port,
            useProxy,
        };
        const dialog = new ConfigureScrcpy(tracker, descriptor, options);
        dialog.on('closed', StreamClientScrcpy.onConfigureDialogClosed);
    };

    private static onConfigureDialogClosed = (event: { dialog: ConfigureScrcpy; result: boolean }): void => {
        event.dialog.off('closed', StreamClientScrcpy.onConfigureDialogClosed);
        if (event.result) {
            HostTracker.getInstance().destroy();
        }
    };
}
