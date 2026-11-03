export interface AndroidStatus {
    batteryLevel?: number;
    charging?: boolean;
    wifiConnected?: boolean;
    wifiRssi?: number;
    airplaneMode?: boolean;
}

export function parseAndroidStatus(battery: string, wifi: string, airplane: string): AndroidStatus {
    const status: AndroidStatus = {};
    const level = battery.match(/^\s*level:\s*(\d+)/m);
    const scale = battery.match(/^\s*scale:\s*(\d+)/m);
    if (level && scale && Number(scale[1]) > 0) {
        status.batteryLevel = Math.min(100, Math.max(0, Math.round((Number(level[1]) / Number(scale[1])) * 100)));
    }
    const charging = battery.match(/^\s*status:\s*(\d+)/m);
    if (charging) {
        status.charging = Number(charging[1]) === 2;
    }
    const connection = wifi
        .split('\n')
        .find((line) => /(?:WifiInfo|mWifiInfo|RSSI:)/i.test(line) && /SSID:/i.test(line));
    if (/^(?:Wi-Fi|Wifi) is disabled/im.test(wifi)) {
        status.wifiConnected = false;
    } else if (connection) {
        const rssi = connection.match(/RSSI:\s*(-?\d+)/i);
        const invalid = /(?:<unknown ssid>|BSSID:\s*(?:<none>|null)|(?:NetworkId|Net ID):\s*-1)/i.test(connection);
        status.wifiConnected = !invalid && !!rssi && Number(rssi[1]) > -127;
        if (status.wifiConnected && rssi) {
            status.wifiRssi = Number(rssi[1]);
        }
    } else if (/Wifi is (?:disabled|enabled)|Wi-Fi is (?:disabled|enabled)|mWifiState\s*[=:]\s*[13]/i.test(wifi)) {
        status.wifiConnected = false;
    }
    if (/^[01]$/.test(airplane.trim())) {
        status.airplaneMode = airplane.trim() === '1';
    }
    return status;
}
