// Run: node tests/adb-file-server.test.cjs
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const { EventEmitter } = require('events');
function load(file, dependencies = {}) {
    const context = { exports: {}, Buffer, require: (id) => id in dependencies ? dependencies[id] : require(id) };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true },
    }).outputText, context);
    return context.exports;
}
class Channel extends EventEmitter {
    constructor() { super(); this.OPEN = 1; this.readyState = 1; this.sent = []; }
    addEventListener(type, fn) { this.on(type, fn); }
    removeEventListener(type, fn) { this.off(type, fn); }
    send(data) { assert.strictEqual(this.readyState, 1); this.sent.push(data); }
    close() { this.readyState = 3; this.emit('close'); }
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
(async () => {
    let transfer;
    const { AdbUtils } = load('src/server/goog-device/AdbUtils.ts', {
        '../../common/Action': {ACTION: {}},
        './adb': {AdbExtended: {createClient: () => ({pull: async () => transfer})}},
    });
    function newTransfer() { const t = new EventEmitter(); t.destroy = () => { t.destroyed = true; }; return t; }
    transfer = newTransfer();
    const stream = new Channel();
    const pull = AdbUtils.pipePullFileToStream('phone', '/file', stream);
    await tick();
    transfer.emit('data', Buffer.from('hello'));
    transfer.emit('end');
    await pull;
    assert.strictEqual(stream.sent[0].toString(), 'DATAhello');
    assert.strictEqual(stream.sent[1].toString(), 'DONE');
    transfer = newTransfer();
    const cancelledStream = new Channel();
    const cancelled = AdbUtils.pipePullFileToStream('phone', '/file', cancelledStream);
    await tick(); cancelledStream.close(); await cancelled;
    assert.strictEqual(transfer.destroyed, true);
    assert.doesNotThrow(() => transfer.emit('error', new Error('late transport error')));
    transfer = newTransfer();
    const failed = assert.rejects(AdbUtils.pipePullFileToStream('phone', '/file', new Channel()), /permission denied/);
    await tick(); transfer.emit('error', new Error('permission denied')); await failed;
    assert.strictEqual(transfer.destroyed, true);
    const { FileListing } = load('src/server/goog-device/mw/FileListing.ts', {
        '../../mw/Mw': {Mw: class {}},
        '../AdbUtils': {AdbUtils: {pipeReadDirToStream: async () => { throw new Error('Permission denied'); }}},
        '../../../app/Util': {},
        '../../../common/ChannelCode': {ChannelCode: {}},
        '../filePush/FilePushReader': {},
    });
    const errorStream = new Channel();
    await FileListing.handle('LIST', 'phone', '/private', errorStream);
    assert.strictEqual(errorStream.sent[0].slice(0, 4).toString(), 'FAIL');
    assert.strictEqual(errorStream.sent[0].slice(8).toString(), 'Permission denied');
    const { ExtendedClient } = load('src/server/goog-device/adb/ExtendedClient.ts', {
        './command/host-transport/sync': {},
    });
    let ended = 0;
    const client = Object.create(ExtendedClient.prototype);
    client.pipeSyncService = async () => ({
        pipeReadDir: async () => { throw new Error('test'); },
        pipePull: async () => { throw new Error('test'); },
        pipeStat: async () => { throw new Error('test'); },
        end: () => { ended++; },
    });
    for (const method of ['pipeReadDir', 'pipePull', 'pipeStat']) {
        await assert.rejects(client[method]('phone', '/path', new Channel()), /test/);
    }
    assert.strictEqual(ended, 3);
    const { normalizeDevicePath, formatFileSize } = load('src/app/googDevice/client/DeviceFileBrowser.ts', {
        '../../../style/modal.css': {}, '../../../style/device-file-browser.css': {},
        '../../../common/Action': {}, './AdbFileService': {}, '../../ui/SvgImage': {},
    });
    assert.strictEqual(normalizeDevicePath('../Pictures', '/sdcard/Download'), '/sdcard/Pictures');
    assert.strictEqual(normalizeDevicePath('/../../'), '/');
    assert.throws(() => normalizeDevicePath('/bad\0path'));
    assert.strictEqual(formatFileSize(0), '0 Б');
    assert.strictEqual(formatFileSize(1024), '1.0 КБ');
    console.log('ADB file server: transfer completion, cancellation, late errors, failure replies and sync cleanup passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
