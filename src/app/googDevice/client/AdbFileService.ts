import { ManagerClient } from '../../client/ManagerClient';
import { ParamsFileListing } from '../../../types/ParamsFileListing';
import { Multiplexer } from '../../../packages/multiplexer/Multiplexer';
import { ChannelCode } from '../../../common/ChannelCode';
import Protocol from '@dead50f7/adbkit/lib/adb/protocol';
import { Entry } from '../Entry';

export const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;

type Reply = { entries: Entry[]; data: Uint8Array[]; stat?: Entry };

/** A dedicated FSLS channel, independent of the device tracker and the page route. */
export class AdbFileService extends ManagerClient<ParamsFileListing, never> {
    private readonly requests = new Map<Multiplexer, (error: Error) => void>();
    private readonly connected: Promise<void>;
    private resolveConnected!: () => void;
    private rejectConnected!: (error: Error) => void;
    private connectTimer?: ReturnType<typeof setTimeout>;

    constructor(params: ParamsFileListing) {
        super(params);
        this.connected = new Promise((resolve, reject) => {
            this.resolveConnected = resolve;
            this.rejectConnected = reject;
        });
        this.connectTimer = setTimeout(
            () => this.rejectConnected(new Error('Сервер не ответил. Проверьте подключение устройства.')),
            15000,
        );
        this.openNewConnection();
    }

    protected buildWebSocketUrl(): URL {
        const direct = super.buildWebSocketUrl();
        return this.params.useProxy ? this.wrapInProxy(direct) : direct;
    }

    protected getChannelInitData(): Buffer {
        const serial = Buffer.from(this.params.udid, 'utf8');
        const buffer = Buffer.alloc(8 + serial.length);
        buffer.write(ChannelCode.FSLS, 'ascii');
        buffer.writeUInt32LE(serial.length, 4);
        serial.copy(buffer, 8);
        return buffer;
    }

    protected supportMultiplexing(): boolean {
        return true;
    }

    protected onSocketOpen(): void {
        clearTimeout(this.connectTimer);
        this.resolveConnected();
    }

    protected onSocketMessage(): void {
        // Each operation uses its own nested FSLS channel.
    }

    protected onSocketClose(event: CloseEvent): void {
        clearTimeout(this.connectTimer);
        const error = new Error(
            event.reason || 'Связь с устройством потеряна. Закройте проводник и откройте его снова.',
        );
        this.rejectConnected(error);
        this.requests.forEach((reject) => reject(error));
    }

    public async list(directory: string): Promise<Entry[]> {
        const { stat } = await this.request(Protocol.STAT, directory);
        if (!stat || stat.mode === 0) throw new Error('Папка не найдена или недоступна для ADB.');
        if (!stat.isDirectory() && !stat.isSymbolicLink())
            throw new Error('Этот путь указывает на файл, а не на папку.');
        const { entries } = await this.request(Protocol.LIST, directory);
        return entries
            .filter((entry) => entry.name !== '.' && entry.name !== '..')
            .sort((a, b) => {
                if (a.isDirectory() !== b.isDirectory()) {
                    return a.isDirectory() ? -1 : 1;
                }
                return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            });
    }

    public async read(file: string): Promise<Uint8Array> {
        const { data } = await this.request(Protocol.RECV, file);
        const result = new Uint8Array(data.reduce((size, chunk) => size + chunk.length, 0));
        let offset = 0;
        data.forEach((chunk) => {
            result.set(chunk, offset);
            offset += chunk.length;
        });
        return result;
    }

    private async request(command: string, path: string): Promise<Reply> {
        await this.connected;
        if (this.destroyed || !(this.ws instanceof Multiplexer) || !this.hasConnection()) {
            throw new Error('Нет связи с устройством. Откройте проводник заново.');
        }
        if (!path.startsWith('/') || path.includes('\0')) {
            throw new Error('Укажите абсолютный путь на устройстве.');
        }
        const name = Buffer.from(path, 'utf8');
        const payload = Buffer.alloc(8 + name.length);
        payload.write(command, 0, 4, 'ascii');
        payload.writeUInt32LE(name.length, 4);
        name.copy(payload, 8);
        const channel = this.ws.createChannel(payload);
        return new Promise((resolve, reject) => {
            const reply: Reply = { entries: [], data: [] };
            let settled = false;
            let bytes = 0;
            const finish = (error?: Error, abort = false): void => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.requests.delete(channel);
                channel.removeEventListener('message', onMessage);
                channel.removeEventListener('close', onClose);
                if (error) reject(error);
                else resolve(reply);
                if (abort && channel.readyState !== channel.CLOSED && channel.readyState !== channel.CLOSING)
                    channel.close();
            };
            const onMessage = (event: MessageEvent): void => {
                try {
                    const buffer = Buffer.from(event.data);
                    const type = buffer.slice(0, 4).toString('ascii');
                    if (type === Protocol.STAT) {
                        reply.stat = new Entry(
                            path,
                            buffer.readUInt32LE(4),
                            buffer.readUInt32LE(8),
                            buffer.readUInt32LE(12),
                        );
                        finish();
                    } else if (type === Protocol.DENT) {
                        const length = buffer.readUInt32LE(16);
                        if (buffer.length < 20 + length) throw new Error('Некорректный ответ при чтении папки.');
                        reply.entries.push(
                            new Entry(
                                buffer.slice(20, 20 + length).toString('utf8'),
                                buffer.readUInt32LE(4),
                                buffer.readUInt32LE(8),
                                buffer.readUInt32LE(12),
                            ),
                        );
                    } else if (type === Protocol.DATA) {
                        bytes += buffer.length - 4;
                        if (bytes > MAX_PREVIEW_BYTES)
                            throw new Error('Файл слишком большой для предпросмотра (до 5 МБ).');
                        reply.data.push(buffer.slice(4));
                    } else if (type === Protocol.FAIL) {
                        finish(new Error(buffer.slice(8, 8 + buffer.readUInt32LE(4)).toString('utf8')));
                    } else if (type === Protocol.DONE) {
                        finish();
                    } else {
                        throw new Error('Неожиданный ответ ADB.');
                    }
                } catch (error) {
                    finish(error instanceof Error ? error : new Error(String(error)), true);
                }
            };
            const onClose = (event: CloseEvent): void => {
                // LIST completes with a normal channel close, including empty folders.
                if (command === Protocol.LIST && (event.code === 0 || event.code === 1000)) finish();
                else
                    finish(
                        new Error(
                            event.reason || 'Чтение прервано. Проверьте доступ к файлам и подключение устройства.',
                        ),
                    );
            };
            const timer = setTimeout(
                () => finish(new Error('Устройство не ответило за 20 секунд. Попробуйте обновить папку.'), true),
                20000,
            );
            this.requests.set(channel, (error) => finish(error, true));
            channel.addEventListener('message', onMessage);
            channel.addEventListener('close', onClose);
        });
    }

    public cancelPending(): void {
        this.requests.forEach((reject) => reject(new Error('Запрос отменён.')));
    }

    public destroy(): void {
        if (this.destroyed) return;
        clearTimeout(this.connectTimer);
        const error = new Error('Проводник закрыт.');
        this.rejectConnected(error);
        this.requests.forEach((reject) => reject(error));
        super.destroy();
        if (this.ws?.readyState === this.ws?.CONNECTING) this.ws?.close();
    }
}
