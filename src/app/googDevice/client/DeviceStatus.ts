import { AndroidStatus } from '../../../common/AndroidStatus';

export function createDeviceStatus(status: AndroidStatus = {}): HTMLElement {
    const holder = document.createElement('span');
    holder.className = 'device-status-icons';
    const icon = (label: string, content: string, className = ''): void => {
        const item = document.createElement('span');
        item.className = `device-status-icon ${className}`;
        item.title = label;
        item.setAttribute('role', 'img');
        item.setAttribute('aria-label', label);
        item.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
        holder.appendChild(item);
    };
    if (status.airplaneMode) {
        icon(
            'Airplane mode on',
            '<path d="M22 16v-2l-8-5V3a2 2 0 0 0-4 0v6l-8 5v2l8-2v5l-3 2v1l5-1 5 1v-1l-3-2v-5Z"/>',
        );
    }
    const connected = status.wifiConnected;
    const signal = status.wifiRssi === undefined ? 3 : status.wifiRssi >= -55 ? 3 : status.wifiRssi >= -70 ? 2 : 1;
    const opacity = (level: number): string => (connected === true && signal >= level ? '1' : '.2');
    icon(
        connected === undefined
            ? 'Wi-Fi status unavailable'
            : connected
            ? `Wi-Fi connected${status.wifiRssi !== undefined ? ` (${status.wifiRssi} dBm)` : ''}`
            : 'Wi-Fi disconnected',
        `<path d="M2 8a16 16 0 0 1 20 0" opacity="${opacity(3)}"/><path d="M5 12a11 11 0 0 1 14 0" opacity="${opacity(
            2,
        )}"/><path d="M8.5 16a5.5 5.5 0 0 1 7 0" opacity="${opacity(
            1,
        )}"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/>${
            connected === false ? '<path d="m3 3 18 18"/>' : ''
        }`,
        connected === false ? 'is-low' : connected === undefined ? 'is-unknown' : '',
    );
    const level = status.batteryLevel;
    icon(
        level === undefined ? 'Battery status unavailable' : `Battery ${level}%${status.charging ? ', charging' : ''}`,
        `<rect x="2" y="6" width="18" height="12" rx="2"/><path d="M22 10v4"/>${
            level === undefined
                ? '<path d="M11 9v3m0 3h.01"/>'
                : `<rect x="4" y="8" width="${
                      (14 * level) / 100
                  }" height="8" rx=".6" fill="currentColor" stroke="none"/>`
        }`,
        level === undefined ? 'is-unknown' : level <= 20 ? 'is-low' : status.charging ? 'is-charging' : '',
    );
    if (status.charging) {
        icon(
            'Charging',
            '<path d="m13 2-8 12h6l-1 8 9-13h-7Z" fill="currentColor" stroke="none"/>',
            'device-status-charging is-charging',
        );
    }
    return holder;
}
