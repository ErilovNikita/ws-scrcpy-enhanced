export const CONNECT_ADB_DEVICE = 'connect_adb_device';

export function validateAdbAddress(host: unknown, port: unknown): { host: string; port: number } {
    if (typeof host !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host.trim())) {
        throw new Error('Укажите корректный IPv4-адрес устройства, например 192.168.1.10.');
    }
    const address = host.trim();
    if (address.split('.').some((part) => Number(part) > 255 || (part.length > 1 && part[0] === '0'))) {
        throw new Error('Некорректный IP-адрес устройства.');
    }
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Порт должен быть целым числом от 1 до 65535.');
    }
    return { host: address, port };
}
