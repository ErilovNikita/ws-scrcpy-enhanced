// Run: node tests/android-status.test.cjs
const assert = require('assert');
const fs = require('fs');
const ts = require('typescript');
const vm = require('vm');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/common/AndroidStatus.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, context);
const parse = (...args) => JSON.parse(JSON.stringify(context.exports.parseAndroidStatus(...args)));
const wifi = 'Wi-Fi is enabled\nWifiInfo: SSID: MyNetwork, BSSID: aa:bb:cc:dd:ee:ff, RSSI: -68, Net ID: 4';
assert.deepStrictEqual(parse('level: 37\nscale: 100\nstatus: 2', wifi, '1'), {
    batteryLevel: 37, charging: true, wifiConnected: true, wifiRssi: -68, airplaneMode: true,
});
assert.deepStrictEqual(parse('level: 1\nscale: 5\nstatus: 3', 'Wifi is disabled', '0'), {
    batteryLevel: 20, charging: false, wifiConnected: false, airplaneMode: false,
});
assert.strictEqual(parse('', 'mWifiInfo SSID: <unknown ssid>, BSSID: <none>, RSSI: -127, NetworkId: -1', '').wifiConnected, false);
assert.strictEqual(parse('', 'Wi-Fi is disabled\n' + wifi, '').wifiConnected, false);
assert.strictEqual(parse('level: 100\nscale: 100\nstatus: 5', '', '').charging, false);
assert.deepStrictEqual(parse('Permission denied', 'Unknown command: status', 'null'), {});
assert.deepStrictEqual(parse('level: 10\nscale: 0', '', ''), {});
console.log('Android status parsing tests passed');
