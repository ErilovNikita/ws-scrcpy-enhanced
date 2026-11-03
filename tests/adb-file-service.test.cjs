// Run: node tests/adb-file-service.test.cjs
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
function load(file, dependencies) {
    const context = { exports: {}, Buffer, setTimeout, clearTimeout, require: (id) => dependencies[id] || require(id) };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true },
    }).outputText, context);
    return context.exports;
}
class Channel {
    constructor() { this.OPEN = 1; this.CONNECTING = 0; this.readyState = 1; this.listeners = {}; }
    addEventListener(type, fn) { (this.listeners[type] ||= new Set()).add(fn); }
    removeEventListener(type, fn) { this.listeners[type]?.delete(fn); }
    emit(type, event) { [...(this.listeners[type] || [])].forEach((fn) => fn(event)); }
    close(code = 1000, reason = '') { this.readyState = 3; this.emit('close', {code, reason}); }
    message(buffer) { this.emit('message', {data: buffer}); }
}
class Mux extends Channel {
    constructor() { super(); this.children = []; }
    createChannel(payload) { const channel = new Channel(); channel.payload = payload; this.children.push(channel); return channel; }
}
const mux = new Mux();
class ManagerClient {
    constructor(params) { this.params = params; this.destroyed = false; }
    openNewConnection() { this.ws = mux; queueMicrotask(() => this.onSocketOpen()); }
    hasConnection() { return this.ws.readyState === 1; }
    buildWebSocketUrl() { return new URL('ws://remote:8000/?action=multiplex'); }
    wrapInProxy(direct) { const url = new URL('ws://local:8000/?action=proxy-ws'); url.searchParams.set('ws', direct.toString()); return url; }
    destroy() { this.destroyed = true; this.ws.close(); }
}
const { Stats } = load('src/app/googDevice/Stats.ts', {});
const { Entry } = load('src/app/googDevice/Entry.ts', {'./Stats': {Stats}});
const { AdbFileService, MAX_PREVIEW_BYTES } = load('src/app/googDevice/client/AdbFileService.ts', {
    '../../client/ManagerClient': {ManagerClient},
    '../../../packages/multiplexer/Multiplexer': {Multiplexer: Mux},
    '../../../common/ChannelCode': {ChannelCode: {FSLS: 'FSLS'}},
    '../Entry': {Entry},
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
const latest = () => mux.children[mux.children.length - 1];
function stat(mode) { const data = Buffer.alloc(16); data.write('STAT'); data.writeUInt32LE(mode, 4); return data; }
function dent(name, mode, size = 0) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.alloc(20 + nameBuffer.length);
    data.write('DENT'); data.writeUInt32LE(mode, 4); data.writeUInt32LE(size, 8); data.writeUInt32LE(100, 12);
    data.writeUInt32LE(nameBuffer.length, 16); nameBuffer.copy(data, 20); return data;
}
(async () => {
    const service = new AdbFileService({udid: 'phone-1'});
    try {
        const remote = Object.create(AdbFileService.prototype);
        remote.params = {useProxy: true};
        const proxy = remote.buildWebSocketUrl();
        assert.strictEqual(proxy.hostname, 'local');
        assert.strictEqual(proxy.searchParams.get('ws'), 'ws://remote:8000/?action=multiplex');
        const init = service.getChannelInitData();
        assert.strictEqual(init.slice(0, 4).toString(), 'FSLS');
        assert.strictEqual(init.slice(8).toString(), 'phone-1');
        const pending = service.list('/sdcard');
        await tick();
        assert.strictEqual(latest().payload.slice(0, 4).toString(), 'STAT');
        latest().message(stat(0o040755));
        await tick();
        assert.strictEqual(latest().payload.slice(0, 4).toString(), 'LIST');
        latest().message(dent('file10.txt', 0o100644, 10));
        latest().message(dent('..', 0o040755));
        latest().message(dent('Pictures', 0o040755));
        latest().message(dent('file2.txt', 0o100644, 2));
        latest().close(0);
        assert.strictEqual((await pending).map((entry) => entry.name).join(','), 'Pictures,file2.txt,file10.txt');
        const empty = service.list('/empty');
        await tick(); latest().message(stat(0o040755)); await tick(); latest().close(0);
        assert.strictEqual((await empty).length, 0);
        const missing = assert.rejects(service.list('/missing'), /не найдена/);
        await tick(); latest().message(stat(0)); await missing;
        const forbidden = assert.rejects(service.list('/private'), /Permission denied/);
        await tick(); latest().message(stat(0o040755)); await tick(); latest().close(4000, 'Permission denied'); await forbidden;
        const read = service.read('/empty.txt');
        await tick(); latest().message(Buffer.from('DONE'));
        assert.strictEqual((await read).length, 0);
        const text = service.read('/hello.txt');
        await tick(); latest().message(Buffer.concat([Buffer.from('DATA'), Buffer.from('Привет')])); latest().message(Buffer.from('DONE'));
        assert.strictEqual(Buffer.from(await text).toString(), 'Привет');
        const interrupted = assert.rejects(service.read('/cut.txt'), /прервано/);
        await tick(); latest().close(1000); await interrupted;
        const large = assert.rejects(service.read('/large.txt'), /слишком большой/);
        await tick(); latest().message(Buffer.concat([Buffer.from('DATA'), Buffer.alloc(MAX_PREVIEW_BYTES + 1)])); await large;
        const cancelled = assert.rejects(service.read('/cancel.txt'), /отменён/);
        await tick(); service.cancelPending(); await cancelled;
        assert.strictEqual(service.requests.size, 0);
        console.log('ADB file service: directory validation, sorting, empty folders, access errors, UTF-8, preview limit and cancellation passed');
    } finally { service.destroy(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
