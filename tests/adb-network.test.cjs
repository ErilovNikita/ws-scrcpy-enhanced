// Run: node tests/adb-network.test.cjs
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
function load(file, dependencies = {}) {
    const context = { exports: {}, require: (id) => {
        if (Object.prototype.hasOwnProperty.call(dependencies, id)) return dependencies[id];
        return require(id);
    }, setTimeout, clearTimeout };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true },
    }).outputText, context, { filename: file });
    return context.exports;
}
const network = load('src/common/AdbNetwork.ts');
for (const [host, port] of [['example.com', 5555], ['256.1.1.1', 5555], ['127.0.0.1; whoami', 5555], ['01.2.3.4', 5555], ['192.168.1.2', 0], ['192.168.1.2', 65536], ['192.168.1.2', 3.5], ['192.168.1.2', '5555']]) {
    assert.throws(() => network.validateAdbAddress(host, port));
}
assert.strictEqual(network.validateAdbAddress(' 192.168.1.2 ', 5555).host, '192.168.1.2');
const { ControlCenterCommand } = load('src/common/ControlCenterCommand.ts', { './AdbNetwork': network });
const command = ControlCenterCommand.fromJSON(JSON.stringify({ id: 42, type: network.CONNECT_ADB_DEVICE, data: { host: '192.168.1.2', port: 5555 } }));
assert.strictEqual(command.getId(), 42);
assert.strictEqual(command.getData().port, 5555);
let devices = [{ id: '192.168.1.2:5555', type: 'device' }];
let connectError;
let connectCalls = 0;
const client = {
    connect: async (host, port) => { connectCalls++; if (connectError) throw connectError; return `${host}:${port}`; },
    listDevices: async () => devices,
};
const { ControlCenter } = load('src/server/goog-device/services/ControlCenter.ts', {
    'os': { hostname: () => 'test', uptime: () => 1 },
    '../Device': {},
    '../../../common/ControlCenterCommand': { ControlCenterCommand },
    '../adb': { AdbExtended: { createClient: () => client } },
    '../../services/BaseControlCenter': { BaseControlCenter: class {} },
    '../../../common/DeviceState': { DeviceState: { DEVICE: 'device' } },
    '../../../common/AdbNetwork': network,
});
(async () => {
    const center = new ControlCenter();
    const added = [];
    center.handleConnected = (...args) => added.push(args);
    assert.strictEqual(await center.connectNetworkDevice('192.168.1.2', 5555), '192.168.1.2:5555');
    assert.deepStrictEqual(added, [['192.168.1.2:5555', 'device']]);
    await assert.rejects(center.connectNetworkDevice('bad', 5555));
    assert.strictEqual(connectCalls, 1);
    connectError = new Error('Connection refused');
    await assert.rejects(center.connectNetworkDevice('192.168.1.2', 5555), /Connection refused/);
    connectError = undefined;
    devices = [{ id: '192.168.1.2:5555', type: 'unauthorized' }];
    await assert.rejects(center.connectNetworkDevice('192.168.1.2', 5555), /Разрешите отладку/);
    devices = [];
    await assert.rejects(center.connectNetworkDevice('192.168.1.2', 5555), /не готово/);
    assert.strictEqual(added.length, 1);
    const { DeviceTracker } = load('src/server/goog-device/mw/DeviceTracker.ts', {
        '../../mw/Mw': { Mw: class {} },
        '../services/ControlCenter': {},
        '../../../common/ControlCenterCommand': { ControlCenterCommand },
        '../../../common/AdbNetwork': network,
        '../../../common/Action': { ACTION: {} },
        '../../../common/ChannelCode': { ChannelCode: {} },
    });
    const tracker = Object.create(DeviceTracker.prototype);
    const responses = [];
    tracker.sendMessage = (message) => responses.push(message);
    tracker.adt = { connectNetworkDevice: async () => '192.168.1.2:5555' };
    const send = (id, host = '192.168.1.2') => tracker.onSocketMessage({ data: JSON.stringify({ id, type: network.CONNECT_ADB_DEVICE, data: { host, port: 5555 } }) });
    send(42);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(responses[0].id, 42);
    assert.strictEqual(responses[0].data.success, true);
    send(43, 'bad');
    assert.strictEqual(responses[1].id, 43);
    assert.strictEqual(responses[1].data.success, false);
    tracker.adt.connectNetworkDevice = async () => { throw new Error('Connection refused'); };
    send(44);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(responses[2].id, 44);
    assert.strictEqual(responses[2].data.message, 'Connection refused');
    console.log('ADB network validation, connection and response tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
