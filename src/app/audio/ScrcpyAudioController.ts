import { ACTION } from '../../common/Action';
import { ParamsStreamScrcpy } from '../../types/ParamsStreamScrcpy';
import Util from '../Util';
import { Float32PcmPlayer } from '@yume-chan/pcm-player';

type AudioInitial = {
    version: number;
    codec: number;
    sampleRate: number;
    channels: number;
    flags: number;
    bitRate: number;
};

const MAGIC_BYTES_AUDIO_INITIAL = Util.stringToUtf8ByteArray('scrcpy_audio_initial');

export type ScrcpyAudioFrameMode = 'split' | 'combined';

export type ScrcpyAudioOptions = {
    frameMode: ScrcpyAudioFrameMode;
    bitrate?: number;
    channels?: 1 | 2;
};

function normalizeAudioOptions(options?: Partial<ScrcpyAudioOptions>): ScrcpyAudioOptions {
    const frameMode: ScrcpyAudioFrameMode = options?.frameMode === 'split' ? 'split' : 'combined';
    const channelsRaw = options?.channels;
    const channels: 1 | 2 | undefined = channelsRaw === 1 || channelsRaw === 2 ? channelsRaw : undefined;
    const bitrateRaw = options?.bitrate;
    const bitrate = typeof bitrateRaw === 'number' && isFinite(bitrateRaw) && bitrateRaw > 0 ? Math.round(bitrateRaw) : undefined;
    return { frameMode, channels, bitrate };
}

function equalArrays(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
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

function buildAudioDirectUrl(streamWsUrl: string, options: ScrcpyAudioOptions): string {
    const url = new URL(streamWsUrl);
    const audioParams = new URLSearchParams();
    audioParams.set('mode', options.frameMode);
    audioParams.set('ws_audio_frame_mode', options.frameMode);
    if (options.channels) {
        audioParams.set('channels', String(options.channels));
        audioParams.set('ws_audio_channels', String(options.channels));
    }
    if (options.bitrate) {
        audioParams.set('bitrate', String(options.bitrate));
        audioParams.set('audio_bit_rate', String(options.bitrate));
    }
    const audioPath = `/audio${audioParams.toString() ? `?${audioParams.toString()}` : ''}`;

    if (url.searchParams.get('action') === ACTION.PROXY_ADB) {
        url.searchParams.set('path', audioPath);
        return url.toString();
    }

    url.pathname = '/audio';
    url.searchParams.set('mode', options.frameMode);
    url.searchParams.set('ws_audio_frame_mode', options.frameMode);
    if (options.channels) {
        url.searchParams.set('channels', String(options.channels));
        url.searchParams.set('ws_audio_channels', String(options.channels));
    } else {
        url.searchParams.delete('channels');
        url.searchParams.delete('ws_audio_channels');
    }
    if (options.bitrate) {
        url.searchParams.set('bitrate', String(options.bitrate));
        url.searchParams.set('audio_bit_rate', String(options.bitrate));
    } else {
        url.searchParams.delete('bitrate');
        url.searchParams.delete('audio_bit_rate');
    }
    return url.toString();
}

function wrapInProxy(directUrl: string): string {
    const localProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const localUrl = new URL(`${localProtocol}//${location.host}`);
    localUrl.searchParams.set('action', ACTION.PROXY_WS);
    localUrl.searchParams.set('ws', directUrl);
    return localUrl.toString();
}

function toAudioBuffer(ctx: AudioContext, audioData: AudioData): AudioBuffer {
    const frames = audioData.numberOfFrames;
    const channels = audioData.numberOfChannels;
    const format = typeof audioData.format === 'string' ? audioData.format : 'f32-planar';
    const isPlanar = format.indexOf('planar') !== -1;
    const buffer = ctx.createBuffer(channels, frames, audioData.sampleRate);

    const copyToFloat32 = (planeIndex: number, elements: number): Float32Array => {
        if (format === 'f32' || format === 'f32-planar') {
            const tmp = new Float32Array(elements);
            audioData.copyTo(tmp, { planeIndex });
            return tmp;
        }
        if (format === 's16' || format === 's16-planar') {
            const tmp = new Int16Array(elements);
            audioData.copyTo(tmp, { planeIndex });
            const out = new Float32Array(elements);
            for (let i = 0; i < elements; i++) {
                out[i] = tmp[i] / 32768;
            }
            return out;
        }
        const tmp = new Float32Array(elements);
        audioData.copyTo(tmp, { planeIndex });
        return tmp;
    };

    if (isPlanar) {
        for (let c = 0; c < channels; c++) {
            const tmp = copyToFloat32(c, frames);
            buffer.copyToChannel(tmp, c);
        }
        return buffer;
    }

    const interleaved = copyToFloat32(0, frames * channels);
    for (let c = 0; c < channels; c++) {
        const tmp = new Float32Array(frames);
        for (let i = 0; i < frames; i++) {
            tmp[i] = interleaved[i * channels + c];
        }
        buffer.copyToChannel(tmp, c);
    }
    return buffer;
}

function toInterleavedFloat32(audioData: AudioData): Float32Array {
    const frames = audioData.numberOfFrames;
    const channels = audioData.numberOfChannels;
    const format = typeof audioData.format === 'string' ? audioData.format : 'f32-planar';
    const isPlanar = format.indexOf('planar') !== -1;

    const copyToFloat32 = (planeIndex: number, elements: number): Float32Array => {
        if (format === 'f32' || format === 'f32-planar') {
            const tmp = new Float32Array(elements);
            audioData.copyTo(tmp, { planeIndex });
            return tmp;
        }
        if (format === 's16' || format === 's16-planar') {
            const tmp = new Int16Array(elements);
            audioData.copyTo(tmp, { planeIndex });
            const out = new Float32Array(elements);
            for (let i = 0; i < elements; i++) {
                out[i] = tmp[i] / 32768;
            }
            return out;
        }
        const tmp = new Float32Array(elements);
        audioData.copyTo(tmp, { planeIndex });
        return tmp;
    };

    if (!isPlanar) {
        return copyToFloat32(0, frames * channels);
    }

    const out = new Float32Array(frames * channels);
    for (let c = 0; c < channels; c++) {
        const plane = copyToFloat32(c, frames);
        for (let i = 0; i < frames; i++) {
            out[i * channels + c] = plane[i] || 0;
        }
    }
    return out;
}

function convertInterleavedFloat32(
    input: Float32Array,
    inChannels: number,
    inSampleRate: number,
    outChannels: number,
    outSampleRate: number,
): Float32Array {
    const safeInChannels = inChannels === 2 ? 2 : 1;
    const safeOutChannels = outChannels === 2 ? 2 : 1;
    const inFrames = Math.floor(input.length / safeInChannels);
    const outFrames =
        inSampleRate === outSampleRate
            ? inFrames
            : Math.max(1, Math.round((inFrames * outSampleRate) / inSampleRate));
    const output = new Float32Array(outFrames * safeOutChannels);
    const rateRatio = inSampleRate / outSampleRate;

    const readMono = (frameIndex: number): number => {
        if (safeInChannels === 1) {
            return input[frameIndex] || 0;
        }
        const base = frameIndex * 2;
        const l = input[base] || 0;
        const r = input[base + 1] || 0;
        return (l + r) * 0.5;
    };

    const readStereo = (frameIndex: number, channel: 0 | 1): number => {
        if (safeInChannels === 2) {
            return input[frameIndex * 2 + channel] || 0;
        }
        const v = input[frameIndex] || 0;
        return v;
    };

    if (inSampleRate === outSampleRate) {
        if (safeInChannels === safeOutChannels) {
            output.set(input.subarray(0, output.length));
            return output;
        }
        if (safeOutChannels === 1) {
            for (let i = 0; i < outFrames; i++) {
                output[i] = readMono(i);
            }
            return output;
        }
        for (let i = 0; i < outFrames; i++) {
            const o = i * 2;
            output[o] = readStereo(i, 0);
            output[o + 1] = readStereo(i, 1);
        }
        return output;
    }

    const maxSrcFrameIndex = Math.max(0, inFrames - 1);
    if (safeOutChannels === 1) {
        for (let i = 0; i < outFrames; i++) {
            const srcPos = i * rateRatio;
            const srcIndex = Math.floor(srcPos);
            const frac = srcPos - srcIndex;
            const s0 = readMono(Math.min(maxSrcFrameIndex, srcIndex));
            const s1 = readMono(Math.min(maxSrcFrameIndex, srcIndex + 1));
            output[i] = s0 + (s1 - s0) * frac;
        }
        return output;
    }
    for (let i = 0; i < outFrames; i++) {
        const srcPos = i * rateRatio;
        const srcIndex = Math.floor(srcPos);
        const frac = srcPos - srcIndex;
        const i0 = Math.min(maxSrcFrameIndex, srcIndex);
        const i1 = Math.min(maxSrcFrameIndex, srcIndex + 1);
        const o = i * 2;
        const l0 = readStereo(i0, 0);
        const l1 = readStereo(i1, 0);
        const r0 = readStereo(i0, 1);
        const r1 = readStereo(i1, 1);
        output[o] = l0 + (l1 - l0) * frac;
        output[o + 1] = r0 + (r1 - r0) * frac;
    }
    return output;
}

function isAdtsFrame(data: Uint8Array): boolean {
    return data.byteLength >= 7 && data[0] === 0xff && (data[1] & 0xf0) === 0xf0;
}

function parseAdtsHeader(data: Uint8Array): {
    audioObjectType: number;
    samplingFrequencyIndex: number;
    channelConfiguration: number;
    headerLength: number;
    frameLength: number;
} {
    const protectionAbsent = (data[1] & 0x01) === 1;
    const profile = (data[2] & 0xc0) >> 6;
    const samplingFrequencyIndex = (data[2] & 0x3c) >> 2;
    const channelConfiguration = ((data[2] & 0x01) << 2) | ((data[3] & 0xc0) >> 6);
    const frameLength = ((data[3] & 0x03) << 11) | (data[4] << 3) | ((data[5] & 0xe0) >> 5);
    const headerLength = protectionAbsent ? 7 : 9;
    return {
        audioObjectType: profile + 1,
        samplingFrequencyIndex,
        channelConfiguration,
        headerLength,
        frameLength,
    };
}

function buildAscFromAdts(header: {
    audioObjectType: number;
    samplingFrequencyIndex: number;
    channelConfiguration: number;
}): Uint8Array {
    const aot = header.audioObjectType & 0x1f;
    const sfi = header.samplingFrequencyIndex & 0x0f;
    const ch = header.channelConfiguration & 0x0f;
    const b0 = (aot << 3) | (sfi >> 1);
    const b1 = ((sfi & 1) << 7) | (ch << 3);
    return Uint8Array.from([b0, b1]);
}

function sampleRateFromIndex(index: number): number {
    switch (index) {
        case 0:
            return 96000;
        case 1:
            return 88200;
        case 2:
            return 64000;
        case 3:
            return 48000;
        case 4:
            return 44100;
        case 5:
            return 32000;
        case 6:
            return 24000;
        case 7:
            return 22050;
        case 8:
            return 16000;
        case 9:
            return 12000;
        case 10:
            return 11025;
        case 11:
            return 8000;
        case 12:
            return 7350;
        default:
            return 48000;
    }
}

function supportsAudioWorklet(ctx: AudioContext): boolean {
    return typeof AudioWorkletNode === 'function' && !!ctx.audioWorklet;
}

function createPcmWorkletModuleUrl(): string {
    const code = `
class WsScrcpyPcmPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.channels = 2;
    this.maxQueuedFrames = sampleRate * 2;
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'reset') {
        this.queue.length = 0;
        this.channels = 2;
        return;
      }
      if (msg.type !== 'push') return;
      const channels = msg.channels | 0;
      const frames = msg.frames | 0;
      const startTime = +msg.startTime;
      const buf = msg.data;
      if (!channels || !frames || !isFinite(startTime) || !(buf instanceof ArrayBuffer)) return;
      const data = new Float32Array(buf);
      const startFrame = Math.max(0, Math.round(startTime * sampleRate));
      this.channels = channels;
      this.queue.push({ startFrame, frames, channels, data, offset: 0 });
      let total = 0;
      for (let i = 0; i < this.queue.length; i++) total += this.queue[i].frames;
      while (total > this.maxQueuedFrames && this.queue.length) {
        const dropped = this.queue.shift();
        total -= dropped ? dropped.frames : 0;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || !out.length) return true;
    const outCh = out.length;
    const blockFrames = out[0].length;
    for (let c = 0; c < outCh; c++) out[c].fill(0);
    if (!this.queue.length) return true;
    const currentFrame = Math.round(currentTime * sampleRate);
    let chunk = this.queue[0];
    if (!chunk) return true;
    const lateBy = currentFrame - chunk.startFrame;
    if (lateBy > 0 && chunk.offset === 0) {
      const skip = Math.min(chunk.frames, lateBy);
      chunk.offset = skip;
    }
    for (let i = 0; i < blockFrames; i++) {
      const frameIndex = currentFrame + i;
      chunk = this.queue[0];
      if (!chunk) break;
      if (frameIndex < chunk.startFrame) continue;
      const rel = frameIndex - chunk.startFrame;
      if (rel < chunk.offset) continue;
      const sampleIndex = rel * chunk.channels;
      if (rel >= chunk.frames) {
        this.queue.shift();
        i--;
        continue;
      }
      for (let c = 0; c < outCh; c++) {
        const srcC = c < chunk.channels ? c : 0;
        out[c][i] = chunk.data[sampleIndex + srcC] || 0;
      }
      if (rel + 1 >= chunk.frames) {
        this.queue.shift();
      }
    }
    return true;
  }
}
registerProcessor('ws-scrcpy-pcm-player', WsScrcpyPcmPlayerProcessor);
`;
    const blob = new Blob([code], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
}

export class ScrcpyAudioController {
    public static isSupported(): boolean {
        return typeof AudioContext === 'function' && typeof AudioDecoder === 'function' && typeof EncodedAudioChunk === 'function';
    }

    private ws?: WebSocket;
    private enabled = false;
    private options: ScrcpyAudioOptions = normalizeAudioOptions({ frameMode: 'combined', channels: 1, bitrate: 64_000 });
    private sessionId = 0;
    private state: 'initial' | 'meta' | 'packet' = 'initial';
    private pendingPtsUs = 0;
    private pendingPacketSize = 0;
    private initial?: AudioInitial;
    private audioConfig?: Uint8Array;
    private cachedAudioConfig?: Uint8Array;
    private decoder?: AudioDecoder;
    private decoderSessionId = 0;
    private ctx?: AudioContext;
    private gain?: GainNode;
    private pcmPlayer?: Float32PcmPlayer;
    private readonly pcmPlayerSampleRate = 48_000;
    private readonly pcmPlayerChannels: 1 | 2 = 2;
    private isAdts = false;
    private adtsHeaderLength = 0;
    private scheduled: AudioBufferSourceNode[] = [];
    private nextStartTime = 0;
    private workletNode?: AudioWorkletNode;
    private workletModuleUrl?: string;

    constructor(private readonly params: ParamsStreamScrcpy) {}

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            this.stop();
            return;
        }
        if (!ScrcpyAudioController.isSupported()) {
            return;
        }
        this.start().catch((_e: unknown) => {
            this.stop();
        });
    }

    public setOptions(options: Partial<ScrcpyAudioOptions>): void {
        const next = normalizeAudioOptions({ ...this.options, ...options });
        const changed =
            next.frameMode !== this.options.frameMode ||
            next.channels !== this.options.channels ||
            next.bitrate !== this.options.bitrate;
        this.options = next;
        if (!changed || !this.enabled) {
            return;
        }
        this.stop();
        this.start().catch((_e: unknown) => {
            this.stop();
        });
    }

    private async start(): Promise<void> {
        if (this.ws && this.ws.readyState === this.ws.OPEN) {
            return;
        }
        this.sessionId++;
        const sid = this.sessionId;

        if (!this.pcmPlayer) {
            try {
                await this.ensurePcmPlayer();
            } catch (_e: unknown) {}
        }
        if (!this.pcmPlayer) {
            if (!this.ctx) {
                this.ctx = new AudioContext({ latencyHint: 'interactive' });
                this.gain = this.ctx.createGain();
                this.gain.gain.value = 1;
                this.gain.connect(this.ctx.destination);
            }
            if (this.ctx.state !== 'running') {
                await this.ctx.resume();
            }
            await this.ensureWorklet();
        }

        const direct = buildAudioDirectUrl(this.params.ws, this.options);
        const url = this.params.useProxy ? wrapInProxy(direct) : direct;
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.binaryType = 'arraybuffer';
        this.state = 'initial';
        this.pendingPtsUs = 0;
        this.pendingPacketSize = 0;
        this.initial = undefined;
        this.audioConfig = undefined;
        this.isAdts = false;
        this.adtsHeaderLength = 0;
        this.nextStartTime = 0;
        ws.onmessage = (event: MessageEvent) => {
            if (this.sessionId !== sid || this.ws !== ws) {
                return;
            }
            this.onWsMessage(event).catch((_e: unknown) => {
                if (this.sessionId !== sid || this.ws !== ws) {
                    return;
                }
                this.stop();
            });
        };
        ws.onclose = () => {
            if (this.sessionId !== sid || this.ws !== ws) {
                return;
            }
            this.stop();
        };
        ws.onerror = () => {
            if (this.sessionId !== sid || this.ws !== ws) {
                return;
            }
            this.stop();
        };
    }

    private stop(): void {
        this.sessionId++;
        const ws = this.ws;
        this.ws = undefined;
        if (ws) {
            ws.onmessage = null;
            ws.onclose = null;
            ws.onerror = null;
            if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
                try {
                    ws.close();
                } catch (_e: unknown) {}
            }
        }
        this.state = 'initial';
        this.pendingPtsUs = 0;
        this.pendingPacketSize = 0;
        this.initial = undefined;
        this.audioConfig = undefined;
        this.isAdts = false;
        this.adtsHeaderLength = 0;
        this.nextStartTime = 0;
        this.stopPcmPlayer();
        while (this.scheduled.length) {
            const n = this.scheduled.shift();
            if (n) {
                try {
                    n.stop();
                } catch (_e: unknown) {}
                try {
                    n.disconnect();
                } catch (_e: unknown) {}
            }
        }
        if (this.workletNode) {
            try {
                this.workletNode.port.postMessage({ type: 'reset' });
            } catch (_e: unknown) {}
        }
        if (this.decoder) {
            try {
                this.decoder.close();
            } catch (_e: unknown) {}
            this.decoder = undefined;
        }
        this.decoderSessionId = 0;
    }

    private async ensurePcmPlayer(): Promise<void> {
        if (this.pcmPlayer) {
            return;
        }
        const sid = this.sessionId;
        const player = new Float32PcmPlayer(this.pcmPlayerSampleRate, this.pcmPlayerChannels);
        this.pcmPlayer = player;
        await player.start();
        if (sid !== this.sessionId || this.pcmPlayer !== player) {
            try {
                await player.stop();
            } catch (_e: unknown) {}
        }
    }

    private stopPcmPlayer(): void {
        const player = this.pcmPlayer;
        this.pcmPlayer = undefined;
        if (!player) {
            return;
        }
        player.stop().catch((_e: unknown) => {});
    }

    private async ensureWorklet(): Promise<void> {
        if (!this.ctx || !this.gain) {
            return;
        }
        if (this.workletNode) {
            return;
        }
        if (!supportsAudioWorklet(this.ctx)) {
            return;
        }
        const sid = this.sessionId;
        if (!this.workletModuleUrl) {
            this.workletModuleUrl = createPcmWorkletModuleUrl();
        }
        await this.ctx.audioWorklet.addModule(this.workletModuleUrl);
        if (sid !== this.sessionId || !this.ctx || !this.gain || this.workletNode) {
            return;
        }
        const node = new AudioWorkletNode(this.ctx, 'ws-scrcpy-pcm-player', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
        });
        node.connect(this.gain);
        this.workletNode = node;
    }

    private async onWsMessage(event: MessageEvent): Promise<void> {
        const bytes = await this.toBytes(event.data);
        if (!bytes) {
            return;
        }

        if (this.state === 'initial') {
            this.handleInitial(bytes);
            this.state = 'meta';
            return;
        }

        if (this.state === 'meta') {
            if (bytes.byteLength < 12) {
                this.stop();
                return;
            }
            const ptsUs = readI64BE(bytes, 0);
            const size = readU32BE(bytes, 8);
            if (bytes.byteLength === 12) {
                this.pendingPtsUs = ptsUs;
                this.pendingPacketSize = size;
                this.state = 'packet';
                return;
            }
            const payload = bytes.subarray(12);
            if (payload.byteLength !== size) {
                this.stop();
                return;
            }
            this.onPacket(ptsUs, payload);
            this.state = 'meta';
            return;
        }

        if (bytes.byteLength !== this.pendingPacketSize) {
            this.stop();
            return;
        }
        this.onPacket(this.pendingPtsUs, bytes);
        this.state = 'meta';
    }

    private handleInitial(bytes: Uint8Array): void {
        if (bytes.byteLength < MAGIC_BYTES_AUDIO_INITIAL.length + 1) {
            throw new Error('Bad audio initial');
        }
        const magic = bytes.subarray(0, MAGIC_BYTES_AUDIO_INITIAL.length);
        if (!equalArrays(magic, MAGIC_BYTES_AUDIO_INITIAL)) {
            throw new Error('Bad audio initial magic');
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let offset = MAGIC_BYTES_AUDIO_INITIAL.length;
        const version = view.getUint8(offset);
        offset += 1;
        const codec = view.getUint8(offset);
        offset += 1;
        offset += 2;
        const sampleRate = view.getUint32(offset, false);
        offset += 4;
        const channels = view.getUint8(offset);
        offset += 1;
        const flags = view.getUint8(offset);
        offset += 1;
        offset += 2;
        const bitRate = view.getUint32(offset, false);
        offset += 4;
        const configLen = view.getUint32(offset, false);
        offset += 4;
        if (bytes.byteLength < offset + configLen) {
            throw new Error('Bad audio initial config');
        }
        this.initial = { version, codec, sampleRate, channels, flags, bitRate };
        if (configLen > 0) {
            this.audioConfig = bytes.subarray(offset, offset + configLen).slice();
            this.cachedAudioConfig = this.audioConfig.slice();
        } else if (this.cachedAudioConfig) {
            this.audioConfig = this.cachedAudioConfig.slice();
        }
        this.ensureConfigured();
    }

    private onPacket(ptsUs: number, packet: Uint8Array): void {
        if (ptsUs === -1) {
            this.audioConfig = packet.slice();
            this.cachedAudioConfig = this.audioConfig.slice();
            if (this.decoder) {
                try {
                    this.decoder.close();
                } catch (_e: unknown) {}
                this.decoder = undefined;
            }
            this.decoderSessionId = 0;
            this.ensureConfigured();
            return;
        }

        let payload = packet;
        if (!this.isAdts && isAdtsFrame(packet)) {
            const header = parseAdtsHeader(packet);
            this.isAdts = true;
            this.adtsHeaderLength = header.headerLength;
            if (this.initial) {
                this.initial.sampleRate = sampleRateFromIndex(header.samplingFrequencyIndex);
                this.initial.channels = header.channelConfiguration || this.initial.channels;
            }
            if (!this.audioConfig) {
                this.audioConfig = buildAscFromAdts(header);
                this.cachedAudioConfig = this.audioConfig.slice();
                this.ensureConfigured();
            }
        }
        if (this.isAdts && isAdtsFrame(packet)) {
            const headerLength = this.adtsHeaderLength || 7;
            if (packet.byteLength > headerLength) {
                payload = packet.subarray(headerLength);
            }
        }

        if (!this.decoder) {
            return;
        }
        const timestampUs = ptsUs > 0 ? ptsUs : 0;
        this.decoder.decode(
            new EncodedAudioChunk({
                type: 'key',
                timestamp: timestampUs,
                data: payload,
            }),
        );
    }

    private ensureConfigured(): void {
        if ((!this.ctx && !this.pcmPlayer) || !this.initial || !this.audioConfig || this.decoder) {
            return;
        }
        const sid = this.sessionId;
        const config: AudioDecoderConfig = {
            codec: 'mp4a.40.2',
            sampleRate: this.initial.sampleRate,
            numberOfChannels: this.initial.channels,
            description: this.audioConfig,
        };
        if (typeof AudioDecoder.isConfigSupported === 'function') {
            AudioDecoder.isConfigSupported(config).then((result) => {
                if (sid !== this.sessionId) {
                    return;
                }
                if (!result.supported) {
                    this.stop();
                    return;
                }
                this.configureDecoder(config);
            }).catch((_e: unknown) => {
                if (sid !== this.sessionId) {
                    return;
                }
                this.stop();
            });
            return;
        }
        this.configureDecoder(config);
    }

    private configureDecoder(config: AudioDecoderConfig): void {
        if ((!this.ctx && !this.pcmPlayer) || this.decoder) {
            return;
        }
        const sid = this.sessionId;
        const decoder = new AudioDecoder({
            output: (audioData: AudioData) => {
                if (this.decoderSessionId !== sid) {
                    audioData.close();
                    return;
                }
                this.onDecoded(audioData);
            },
            error: (_e: DOMException) => {
                this.stop();
            },
        });
        decoder.configure(config);
        this.decoder = decoder;
        this.decoderSessionId = sid;
    }

    private onDecoded(audioData: AudioData): void {
        if (!this.ctx && !this.pcmPlayer) {
            audioData.close();
            return;
        }

        if (this.pcmPlayer) {
            const interleaved = toInterleavedFloat32(audioData);
            const converted = convertInterleavedFloat32(
                interleaved,
                audioData.numberOfChannels,
                audioData.sampleRate,
                this.pcmPlayerChannels,
                this.pcmPlayerSampleRate,
            );
            audioData.close();
            for (let i = 0; i < converted.length; i++) {
                converted[i] = (converted[i] || 0) * 0.9;
            }
            this.pcmPlayer.feed(converted);
            return;
        }

        const startAtMin = this.ctx!.currentTime + 0.01;
        let startAt = Math.max(startAtMin, this.nextStartTime);
        const frames = audioData.numberOfFrames;
        const channels = audioData.numberOfChannels;
        const duration = frames / audioData.sampleRate;
        this.nextStartTime = startAt + duration;

        if (this.workletNode) {
            const interleaved = toInterleavedFloat32(audioData);
            audioData.close();
            this.workletNode.port.postMessage(
                { type: 'push', startTime: startAt, channels, frames, data: interleaved.buffer },
                [interleaved.buffer],
            );
            return;
        }

        const audioBuffer = toAudioBuffer(this.ctx!, audioData);
        audioData.close();
        const source = this.ctx!.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.gain!);
        source.onended = () => {
            const idx = this.scheduled.indexOf(source);
            if (idx >= 0) {
                this.scheduled.splice(idx, 1);
            }
        };
        this.scheduled.push(source);
        source.start(startAt);
    }

    private async toBytes(data: unknown): Promise<Uint8Array | null> {
        if (data instanceof ArrayBuffer) {
            return new Uint8Array(data);
        }
        if (data instanceof Blob) {
            const buf = await data.arrayBuffer();
            return new Uint8Array(buf);
        }
        return null;
    }
}
