// Run: node tests/all-devices-view.test.cjs
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
class Element {
    constructor(tag) {
        this.tag = tag;
        this.children = [];
        this.listeners = {};
        this.attributes = {};
        this.style = {};
        this.contentWindow = {};
        this.srcWrites = 0;
    }
    append(...items) { items.forEach((item) => this.appendChild(item)); }
    appendChild(item) { item.parent = this; this.children.push(item); return item; }
    remove() { if(this.parent) this.parent.children = this.parent.children.filter((item) => item !== this); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    set src(value) { this._src = value; this.srcWrites++; }
    get src() { return this._src; }
}
const location = { origin: 'http://localhost:8000', pathname: '/', href: 'http://localhost:8000/#!action=all-devices' };
const listeners = {};
const timers = new Map();
let timerId = 0;
const document = { body: new Element('body'), createElement: (tag) => new Element(tag) };
const context = { exports: {}, document, location, URL, URLSearchParams,
    window: { addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener: (type) => { delete listeners[type]; } },
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    require: (id) => {
        if (id.endsWith('.css')) return {};
        if (id === '../ui/SvgImage') return { __esModule: true, default: { Icon: {}, create: () => new Element('svg') } };
        throw new Error(id);
    },
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/client/AllDevicesView.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true },
}).outputText, context);
const { AllDevicesView, buildOverviewFrameUrl } = context.exports;
const href = 'http://remote:8000/#!action=stream&udid=192.168.1.2%3A5555&player=webcodecs&ws=ws%3A%2F%2Fremote%3A8000%2F&hostname=remote&port=8000&useProxy=true';
const frameUrl = new URL(buildOverviewFrameUrl(href));
assert.strictEqual(frameUrl.origin, location.origin);
const params = new URLSearchParams(frameUrl.hash.slice(2));
assert.strictEqual(params.get('embedded'), 'overview');
assert.strictEqual(params.get('ws'), 'ws://remote:8000/');
assert.strictEqual(params.get('useProxy'), 'true');
AllDevicesView.start();
const view = AllDevicesView.instance;
const first = { key: 'one', name: 'Android One', href };
view.updateTracker('local', [first]);
const tile = view.tiles.get('one');
assert.strictEqual(view.tiles.size, 1);
assert.strictEqual(tile.frame.srcWrites, 1);
view.updateTracker('local', [{ ...first, name: 'Updated Name' }]);
assert.strictEqual(view.tiles.get('one'), tile, 'status updates must preserve the running iframe');
assert.strictEqual(tile.frame.srcWrites, 1);
assert.strictEqual(tile.title.textContent, 'Updated Name');
view.updateTracker('remote', [first]);
assert.strictEqual(view.tiles.size, 1, 'duplicate tracker entries must not duplicate streams');
listeners.message({ origin: 'https://untrusted', source: tile.frame.contentWindow, data: { type: 'overview-stream-status', status: 'live' } });
assert.strictEqual(tile.status.textContent, 'Подключение…');
listeners.message({ origin: location.origin, source: {}, data: { type: 'overview-stream-status', status: 'live' } });
assert.strictEqual(tile.status.textContent, 'Подключение…');
listeners.message({ origin: location.origin, source: tile.frame.contentWindow, data: { type: 'overview-stream-status', status: 'live' } });
assert.strictEqual(tile.status.textContent, 'В эфире');
assert.strictEqual(timers.size, 0);
listeners.message({ origin: location.origin, source: tile.frame.contentWindow, data: { type: 'overview-stream-status', status: 'size', width: 1920, height: 1080 } });
assert.strictEqual(tile.frame.style.aspectRatio, '1920 / 1080');
assert.strictEqual(tile.status.textContent, 'В эфире');
tile.element.children[0].children[1].listeners.click();
assert.strictEqual(tile.frame.srcWrites, 2, 'retry must restart just the selected stream');
view.removeTracker('local');
assert.strictEqual(view.tiles.size, 1);
view.updateTracker('remote', []);
assert.strictEqual(view.tiles.size, 0);
assert.strictEqual(view.empty.hidden, false);
assert.strictEqual(timers.size, 0);
view.updateTracker('local', [first, { key: 'two', name: 'Android Two', href: href.replace('192.168.1.2', '192.168.1.3') }]);
assert.strictEqual(view.tiles.size, 2);
view.dispose();
assert.strictEqual(timers.size, 0);
assert.strictEqual(document.body.children.length, 0);
assert.strictEqual(listeners.message, undefined);
console.log('All-devices view tests passed');
