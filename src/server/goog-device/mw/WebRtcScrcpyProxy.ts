import WS from 'ws';
import { Mw, RequestParameters } from '../../mw/Mw';
import { ACTION } from '../../../common/Action';

type SignalMessage =
    | { type: 'offer'; sdp: string }
    | { type: 'answer'; sdp: string }
    | { type: 'ice-candidate'; candidate: RTCIceCandidateInit | null }
    | { type: 'error'; message: string };

type WrtcModule = {
    RTCPeerConnection: new () => RTCPeerConnection;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const wrtc: WrtcModule = require('wrtc');

export class WebRtcScrcpyProxy extends Mw {
    public static readonly TAG = 'WebRtcScrcpyProxy';
    private static readonly VIDEO_BUFFER_HIGH_WATER_MARK = 1024 * 1024;
    private readonly udid: string;
    private readonly remoteUrl: string;
    private readonly peer: RTCPeerConnection;
    private readonly videoChannel: RTCDataChannel;
    private controlChannel?: RTCDataChannel;
    private remoteSocket?: WS;

    public static processRequest(ws: WS, params: RequestParameters): WebRtcScrcpyProxy | undefined {
        const { action, url } = params;
        if (action !== ACTION.STREAM_WEBRTC) {
            return;
        }
        const remoteUrl = url.searchParams.get('ws');
        const udid = url.searchParams.get('udid') || '';
        if (!remoteUrl) {
            ws.close(4003, `[${this.TAG}] Missing "ws" parameter`);
            return;
        }
        return new WebRtcScrcpyProxy(ws, udid, remoteUrl);
    }

    constructor(ws: WS, udid: string, remoteUrl: string) {
        super(ws);
        this.udid = udid;
        this.remoteUrl = remoteUrl;
        this.peer = new wrtc.RTCPeerConnection();
        this.videoChannel = this.peer.createDataChannel('video', {
            ordered: false,
            maxRetransmits: 0,
        });
        this.bindPeer();
    }

    protected onSocketMessage(event: WS.MessageEvent): void {
        this.handleSignal(this.toString(event.data)).catch((error: Error) => {
            this.sendSignal({ type: 'error', message: error.message });
            this.ws.close(4501, `[${WebRtcScrcpyProxy.TAG}] ${error.message}`);
        });
    }

    public release(): void {
        super.release();
        if (this.controlChannel) {
            this.controlChannel.close();
            this.controlChannel = undefined;
        }
        this.videoChannel.close();
        this.peer.close();
        if (this.remoteSocket && this.remoteSocket.readyState === this.remoteSocket.OPEN) {
            this.remoteSocket.close();
        }
        this.remoteSocket = undefined;
    }

    private bindPeer(): void {
        this.videoChannel.onopen = () => {
            this.connectRemoteSocket();
        };
        this.videoChannel.onclose = () => {
            if (this.remoteSocket && this.remoteSocket.readyState === this.remoteSocket.OPEN) {
                this.remoteSocket.close();
            }
            this.remoteSocket = undefined;
        };
        this.peer.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
            this.sendSignal({ type: 'ice-candidate', candidate: event.candidate });
        };
        this.peer.ondatachannel = (event: RTCDataChannelEvent) => {
            if (event.channel.label !== 'control') {
                return;
            }
            this.controlChannel = event.channel;
            event.channel.binaryType = 'arraybuffer';
            event.channel.onmessage = (message: MessageEvent) => {
                if (this.remoteSocket && this.remoteSocket.readyState === this.remoteSocket.OPEN) {
                    this.remoteSocket.send(message.data);
                }
            };
        };
        this.peer.onconnectionstatechange = () => {
            if (this.peer.connectionState === 'failed' || this.peer.connectionState === 'closed') {
                this.release();
            }
        };
    }

    private connectRemoteSocket(): void {
        if (this.remoteSocket) {
            return;
        }
        const remoteSocket = new WS(this.remoteUrl);
        this.remoteSocket = remoteSocket;
        remoteSocket.binaryType = 'arraybuffer';
        remoteSocket.onmessage = (event: WS.MessageEvent) => {
            if (this.videoChannel.readyState !== 'open') {
                return;
            }
            if (this.videoChannel.bufferedAmount > WebRtcScrcpyProxy.VIDEO_BUFFER_HIGH_WATER_MARK) {
                return;
            }
            this.videoChannel.send(this.toBinary(event.data));
        };
        remoteSocket.onerror = () => {
            if (this.ws.readyState === this.ws.OPEN) {
                this.ws.close(4502, `[${WebRtcScrcpyProxy.TAG}] Device stream socket error (${this.udid})`);
            }
        };
        remoteSocket.onclose = () => {
            if (this.ws.readyState === this.ws.OPEN) {
                this.ws.close(4503, `[${WebRtcScrcpyProxy.TAG}] Device stream socket closed (${this.udid})`);
            }
        };
    }

    private async handleSignal(raw: string): Promise<void> {
        let message: SignalMessage;
        try {
            message = JSON.parse(raw) as SignalMessage;
        } catch {
            throw new Error('Invalid signaling payload');
        }
        if (message.type === 'offer') {
            await this.peer.setRemoteDescription({ type: 'offer', sdp: message.sdp });
            const answer = await this.peer.createAnswer();
            await this.peer.setLocalDescription(answer);
            if (!answer.sdp) {
                throw new Error('Answer SDP is empty');
            }
            this.sendSignal({ type: 'answer', sdp: answer.sdp });
            return;
        }
        if (message.type === 'ice-candidate' && message.candidate) {
            await this.peer.addIceCandidate(message.candidate);
            return;
        }
    }

    private sendSignal(message: SignalMessage): void {
        if (this.ws.readyState !== this.ws.OPEN) {
            return;
        }
        this.ws.send(JSON.stringify(message));
    }

    private toString(data: unknown): string {
        if (typeof data === 'string') {
            return data;
        }
        if (Buffer.isBuffer(data)) {
            return data.toString('utf-8');
        }
        if (Array.isArray(data) && data.every((value) => Buffer.isBuffer(value))) {
            return Buffer.concat(data).toString('utf-8');
        }
        return Buffer.from(data as ArrayBuffer).toString('utf-8');
    }

    private toBinary(data: unknown): ArrayBuffer {
        if (data instanceof ArrayBuffer) {
            return data;
        }
        if (Buffer.isBuffer(data)) {
            return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        }
        if (Array.isArray(data) && data.every((value) => Buffer.isBuffer(value))) {
            const merged = Buffer.concat(data);
            return merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength);
        }
        const fallback = Buffer.from(data as ArrayBuffer);
        return fallback.buffer.slice(fallback.byteOffset, fallback.byteOffset + fallback.byteLength);
    }
}
