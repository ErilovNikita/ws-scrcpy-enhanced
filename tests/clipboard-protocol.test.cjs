// Run: node tests/clipboard-protocol.test.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let transform;
try {
    const ts = require('typescript');
    transform = (source) => ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
    }).outputText;
} catch (error) {
    // Allows running without installed project dependencies on Node 24+.
    const { stripTypeScriptTypes } = require('module');
    if (!stripTypeScriptTypes) {
        throw new Error('Install project dependencies or use Node 24+ to run this test.');
    }
    transform = (source) => stripTypeScriptTypes(source, { mode: 'transform' })
        .replace(/^import .*;\n/gm, '')
        .replace(/export /g, '');
}

function load(relativePath, names, dependencies = {}) {
    const filename = path.join(__dirname, '..', relativePath);
    const context = { Buffer, ...dependencies, exports: {} };
    context.require = (id) => {
        if (id === 'buffer') return { Buffer };
        if (id === './ControlMessage') return dependencies;
        // VideoSettings and Util are not used by clipboard serialization.
        if (id === '../VideoSettings' || id === '../Util') return {};
        throw new Error(`Unexpected import: ${id}`);
    };
    vm.runInNewContext(transform(fs.readFileSync(filename, 'utf8')) +
        `\nglobalThis.result = { ${names.join(', ')} };`, context, { filename });
    return context.result;
}

const { ControlMessage } = load('src/app/controlMessage/ControlMessage.ts', ['ControlMessage']);
const { CommandControlMessage } = load('src/app/controlMessage/CommandControlMessage.ts',
    ['CommandControlMessage'], { ControlMessage });

// Fixed offsets from ControlMessageReader.parseSetClipboard DEX instructions:
// readLong (sequence), readByte (paste), parseString (4-byte length + UTF-8).
for (const text of ['', 'Hello', 'Привет', 'Ёжик ёлка', 'English + русский 😀\nНовая строка']) {
    for (const paste of [false, true]) {
        const packet = CommandControlMessage.createSetClipboardCommand(text, paste, 123).toBuffer();
        assert.strictEqual(packet[0], 9);
        assert.strictEqual(packet.readUInt32BE(1), 0);
        assert.strictEqual(packet.readUInt32BE(5), 123);
        assert.strictEqual(packet[9], paste ? 1 : 0);
        assert.strictEqual(packet.readUInt32BE(10), Buffer.byteLength(text, 'utf8'));
        assert.strictEqual(packet.subarray(14).toString('utf8'), text);
        assert.strictEqual(packet.length, 14 + Buffer.byteLength(text, 'utf8'));
    }
}
assert.strictEqual(CommandControlMessage.createGetClipboardCommand().toBuffer().toString('hex'), '0800');
console.log('Clipboard protocol: 10 round trips passed; get-clipboard packet passed.');
