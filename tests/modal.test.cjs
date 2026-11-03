// Run: node tests/modal.test.cjs
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.value = ''; }
    append(...items) { items.forEach((item) => this.appendChild(item)); }
    appendChild(item) { this.children.push(item); item.parent = this; return item; }
    insertBefore(item, before) { this.children.splice(this.children.indexOf(before), 0, item); item.parent = this; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    get isConnected() { return this === document.body || !!this.parent?.isConnected; }
    remove() { this.parent.children = this.parent.children.filter((item) => item !== this); this.parent = null; }
    reset() { find(this, 'input').forEach((input) => { input.value = ''; }); }
    focus() { document.activeElement = this; }
    select() {}
    showModal() { this.open = true; }
    close() { this.open = false; (this.listeners.close || []).forEach((callback) => callback()); }
}
function find(parent, tag) { return parent.children.flatMap((child) => [...(child.tagName === tag ? [child] : []), ...find(child, tag)]); }
const document = { body: new Element('body'), createElement: (tag) => new Element(tag) };
const previousFocus = new Element('button');
document.body.appendChild(previousFocus);
previousFocus.focus();
function load(file, dependencies) {
    const context = { exports: {}, document, require: (id) => {
        if (id in dependencies) return dependencies[id];
        throw new Error(id);
    } };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true },
    }).outputText, context);
    return context.exports;
}
const modal = load('src/app/ui/Modal.ts', {
    '../../style/modal.css': {},
    './SvgImage': { __esModule: true, Icon: {}, default: { Icon: {}, create: () => new Element('svg') } },
});
(async () => {
    const promise = modal.promptUploadDirectory('/sdcard/Download');
    const dialog = find(document.body, 'dialog')[0];
    const input = find(dialog, 'input')[0];
    const form = find(dialog, 'form')[0];
    input.value = '../bad';
    form.onsubmit({ preventDefault() {} });
    assert.strictEqual(dialog.open, true, 'invalid paths must keep the dialog open');
    assert.strictEqual(form.children.find((item) => item.className === 'app-modal-error').hidden, false);
    input.value = ' /sdcard/Download/// ';
    form.onsubmit({ preventDefault() {} });
    assert.strictEqual(await promise, '/sdcard/Download');
    assert.strictEqual(input.value, '', 'closing clears the field');
    assert.strictEqual(dialog.isConnected, false);
    assert.strictEqual(document.activeElement, previousFocus);
    const cancelled = modal.promptUploadDirectory('/sdcard/Download');
    find(document.body, 'dialog')[0].close();
    assert.strictEqual(await cancelled, null);
    const text = '<img src=x onerror=alert(1)>';
    modal.showNotice('Ошибка', text);
    modal.showNotice('Ошибка', text);
    assert.strictEqual(find(document.body, 'dialog').length, 1, 'identical errors must not stack');
    const notice = find(document.body, 'dialog')[0];
    assert.strictEqual(find(notice, 'p')[0].textContent, text, 'server error text must be rendered as text');
    find(notice, 'form')[0].onsubmit({ preventDefault() {} });
    assert.strictEqual(find(document.body, 'dialog').length, 0);
    console.log('Modal validation, cancellation, cleanup and error rendering tests passed');

    const { default: FilePushHandler } = load('src/app/googDevice/filePush/FilePushHandler.ts', {
        '../DragAndDropHandler': {},
        './FilePushResponseStatus': { FilePushResponseStatus: {} },
    });
    const handler = Object.create(FilePushHandler.prototype);
    const uploaded = [];
    handler.filePushStream = { isAllowedFile: () => true };
    handler.pushFile = (file, path) => uploaded.push({ file, path });
    let resolveDirectory;
    handler.options = { resolveDestinationDir: () => new Promise((resolve) => { resolveDirectory = resolve; }) };
    const file = { name: 'test.txt' };
    const pending = handler.pushFiles([file]);
    assert.strictEqual(uploaded.length, 0, 'uploads wait for the modal result');
    resolveDirectory('/sdcard/Download');
    await pending;
    assert.strictEqual(uploaded[0].path, '/sdcard/Download');
    handler.options.resolveDestinationDir = async () => null;
    await handler.pushFiles([file]);
    assert.strictEqual(uploaded.length, 1, 'cancelling must not start an upload');
    handler.options.resolveDestinationDir = async () => undefined;
    await handler.pushFiles([file]);
    assert.strictEqual(uploaded.length, 2);
    assert.strictEqual(uploaded[1].path, undefined, 'an empty path keeps the default destination');
    await handler.pushFiles([file], '/explicit');
    assert.strictEqual(uploaded[2].path, '/explicit');
    const errors = [];
    handler.listeners = new Set([{ onError: (error) => errors.push(error) }]);
    handler.options.resolveDestinationDir = async () => { throw new Error('Dialog failed'); };
    await handler.pushFiles([file]);
    assert.strictEqual(uploaded.length, 3);
    assert.strictEqual(String(errors[0]), 'Error: Dialog failed');
    console.log('Upload directory selection tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
