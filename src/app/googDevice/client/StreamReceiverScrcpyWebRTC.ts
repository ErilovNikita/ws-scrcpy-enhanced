import { StreamReceiverScrcpy } from './StreamReceiverScrcpy';
import { ACTION } from '../../../common/Action';
import { ControlMessage } from '../../controlMessage/ControlMessage';

type SignalMessage =
    | { type: 'offer'; sdp: string }
    | { type: 'answer'; sdp: string }
    | { type: 'ice-candidate'; candidate: RTCIceCandidateInit | null }
    | { type: 'error'; message: string };

export class StreamReceiverScrcpyWebRTC extends StreamReceiverScrcpy {
    private signalSocket?: WebSocket;
    private peer?: RTCPeerConnection;
    private videoChannel?: RTCDataChannel;
    private controlChannel?: RTCDataChannel;
    private controlQueue: ArrayBuffer[] = [];
    private connected = false;

    protected openNewConnection(): WebSocket {
        this.init().catch((error: Error) => {
            console.error('[StreamReceiverScrcpyWebRTC]', error.message);
            this.emit(
                'disconnected',
                new CloseEvent('close', { code: 4501, reason: `WebRTC init failed: ${error.message}` }),
            );
        });
        return undefined as unknown as WebSocket;
    }

    protected buildDirectWebSocketUrl(): URL {
        const { hostname, port, secure } = this.params;
        const streamWsUrl = (this.params as unknown as { ws: string }).ws;
        let urlString: string;
        if (typeof hostname === 'string' && typeof port === 'number') {
            const protocol = secure ? 'wss:' : 'ws:';
            urlString = `${protocol}//${hostname}:${port}`;
        } else {
            const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            urlString = `${protocol}//${location.host}`;
        }
        const signalUrl = new URL(urlString);
        signalUrl.searchParams.set('action', ACTION.STREAM_WEBRTC);
        signalUrl.searchParams.set('udid', this.params.udid);
        signalUrl.searchParams.set('ws', streamWsUrl);
        return signalUrl;
    }

    public hasConnection(): boolean {
        return this.connected;
    }

    public sendEvent(event: ControlMessage): void {
        const buffer = event.toBuffer();
        const payload = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        if (event.type === ControlMessage.TYPE_SET_SCREEN_POWER_MODE) {
            const bytes = Array.from(new Uint8Array(payload));
            const mode = bytes.length > 1 ? bytes[1] : -1;
            console.info(
                `[StreamReceiverScrcpyWebRTC] Send TYPE_SET_SCREEN_POWER_MODE via WebRTC control: mode=${mode}, bytes=[${bytes.join(',')}]`,
            );
        }
        if (this.controlChannel && this.controlChannel.readyState === 'open') {
            this.controlChannel.send(payload);
            return;
        }
        this.controlQueue.push(payload);
    }

    public stop(): void {
        this.connected = false;
        if (this.videoChannel) {
            this.videoChannel.close();
            this.videoChannel = undefined;
        }
        if (this.controlChannel) {
            this.controlChannel.close();
            this.controlChannel = undefined;
        }
        if (this.peer) {
            this.peer.close();
            this.peer = undefined;
        }
        if (this.signalSocket && this.signalSocket.readyState === this.signalSocket.OPEN) {
            this.signalSocket.close();
        }
        this.signalSocket = undefined;
        this.controlQueue.length = 0;
    }

    private async init(): Promise<void> {
        const signalSocket = new WebSocket(this.buildDirectWebSocketUrl().toString());
        this.signalSocket = signalSocket;
        signalSocket.onmessage = (event: MessageEvent) => {
            if (typeof event.data === 'string') {
                if (this.handleFinlinkErrorText(event.data)) {
                    try {
                        signalSocket.close();
                    } catch {}
                    return;
                }
                this.handleSignal(event.data).catch((error: Error) => {
                    console.error('[StreamReceiverScrcpyWebRTC]', error.message);
                });
                return;
            }
            this.handleSignal(event.data.toString()).catch((error: Error) => {
                console.error('[StreamReceiverScrcpyWebRTC]', error.message);
            });
        };
        signalSocket.onclose = (ev: CloseEvent) => {
            this.connected = false;
            this.emit('disconnected', ev);
        };
        signalSocket.onerror = () => {
            this.connected = false;
        };
        await new Promise<void>((resolve, reject) => {
            signalSocket.onopen = () => resolve();
            signalSocket.onerror = () => reject(new Error('Failed to open signaling socket'));
        });
        const peer = new RTCPeerConnection();
        this.peer = peer;
        peer.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
            this.sendSignal({ type: 'ice-candidate', candidate: event.candidate });
        };
        peer.ondatachannel = (event: RTCDataChannelEvent) => {
            if (event.channel.label === 'video') {
                this.bindVideoChannel(event.channel);
            }
        };
        peer.onconnectionstatechange = () => {
            if (peer.connectionState === 'connected' && !this.connected) {
                this.connected = true;
                this.emit('connected', void 0);
            } else if (
                peer.connectionState === 'failed' ||
                peer.connectionState === 'disconnected' ||
                peer.connectionState === 'closed'
            ) {
                this.connected = false;
            }
        };
        const controlChannel = peer.createDataChannel('control');
        controlChannel.binaryType = 'arraybuffer';
        controlChannel.onopen = () => {
            this.flushControlQueue();
        };
        this.controlChannel = controlChannel;
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        if (!offer.sdp) {
            throw new Error('Offer SDP is empty');
        }
        this.sendSignal({ type: 'offer', sdp: offer.sdp });
    }

    private bindVideoChannel(channel: RTCDataChannel): void {
        this.videoChannel = channel;
        channel.binaryType = 'arraybuffer';
        channel.onmessage = (event: MessageEvent) => {
            this.handleVideoMessage(event.data).catch((error: Error) => {
                console.error('[StreamReceiverScrcpyWebRTC]', error.message);
            });
        };
    }

    private async handleVideoMessage(data: unknown): Promise<void> {
        let payload: ArrayBuffer;
        if (data instanceof ArrayBuffer) {
            payload = data;
        } else if (data instanceof Blob) {
            payload = await data.arrayBuffer();
        } else {
            return;
        }
        this.onSocketMessage({ data: payload } as MessageEvent);
    }

    private async handleSignal(raw: string): Promise<void> {
        if (!this.peer) {
            return;
        }
        let message: SignalMessage;
        try {
            message = JSON.parse(raw) as SignalMessage;
        } catch {
            return;
        }
        if (message.type === 'answer') {
            await this.peer.setRemoteDescription({ type: 'answer', sdp: message.sdp });
            return;
        }
        if (message.type === 'ice-candidate' && message.candidate) {
            await this.peer.addIceCandidate(message.candidate);
            return;
        }
        if (message.type === 'error') {
            throw new Error(message.message);
        }
    }

    private sendSignal(message: SignalMessage): void {
        if (!this.signalSocket || this.signalSocket.readyState !== this.signalSocket.OPEN) {
            return;
        }
        this.signalSocket.send(JSON.stringify(message));
    }

    private flushControlQueue(): void {
        if (!this.controlChannel || this.controlChannel.readyState !== 'open') {
            return;
        }
        while (this.controlQueue.length) {
            const payload = this.controlQueue.shift();
            if (payload) {
                this.controlChannel.send(payload);
            }
        }
    }
}
