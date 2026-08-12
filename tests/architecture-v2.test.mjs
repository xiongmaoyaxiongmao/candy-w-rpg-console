import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const srcRoot = path.join(root, 'src');

async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(entry => {
        const absolute = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(absolute) : [absolute];
    }));
    return nested.flat();
}

const productionPaths = [path.join(root, 'index.js'), ...(await walk(srcRoot))]
    .filter(file => file.endsWith('.js'))
    .sort();
const sources = new Map(await Promise.all(productionPaths.map(async absolute => [
    path.relative(root, absolute).split(path.sep).join('/'),
    await readFile(absolute, 'utf8'),
])));

function importsOf(source) {
    const imports = [];
    const pattern = /(?:\bimport\s+(?:[^'";]*?\s+from\s+)?|\bexport\s+[^'";]*?\s+from\s+|\bimport\s*\()(['"])([^'"]+)\1/g;
    for (const match of source.matchAll(pattern)) imports.push(match[2]);
    return imports;
}

function layerOf(file) {
    if (file === 'index.js') return 'entry';
    const match = /^src\/([^/]+)/.exec(file);
    if (!match) return 'unknown';
    if (match[1].endsWith('.js')) return 'legacy-flat';
    return match[1];
}

function resolveLocalImport(importer, specifier) {
    if (!specifier.startsWith('.')) return null;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
    return resolved.endsWith('.js') ? resolved : `${resolved}.js`;
}

test('only the host adapter boundary imports SillyTavern core modules', () => {
    const violations = [];
    for (const [file, source] of sources) {
        for (const specifier of importsOf(source)) {
            if (!/(?:^|\/)(?:extensions|script)\.js(?:[?#].*)?$/.test(specifier)) continue;
            if (!file.startsWith('src/host/')) violations.push(`${file} imports ${specifier}`);
        }
        if (!file.startsWith('src/host/')) {
            const directHostApi = /\b(?:SillyTavern|getContext|setExtensionPrompt|extension_settings|eventSource|event_types|extension_prompt_roles|extension_prompt_types|isGenerating|saveSettingsDebounced)\b/gu;
            for (const match of source.matchAll(directHostApi)) {
                violations.push(`${file} directly references SillyTavern API ${match[0]}`);
            }
        }
    }
    assert.deepEqual(violations, []);
});

test('UI imports only other UI modules and reaches application through its injected contract', () => {
    const violations = [];
    for (const [file, source] of sources) {
        if (!file.startsWith('src/ui/')) continue;
        for (const specifier of importsOf(source)) {
            const resolved = resolveLocalImport(file, specifier);
            if (!resolved?.startsWith('src/ui/')) violations.push(`${file} imports ${specifier}`);
        }
        const forbidden = /\b(?:metadata|prompt|generate|repository|adapter)\b/giu;
        for (const match of source.matchAll(forbidden)) {
            violations.push(`${file} contains forbidden UI boundary token ${match[0]}`);
        }
    }
    assert.deepEqual(violations, []);
    const controller = sources.get('src/ui/controller.js');
    assert.match(controller, /return file\.text\(\)/u, 'UI must pass original JSON text to the strict transfer boundary');
    assert.doesNotMatch(controller, /JSON\.parse\s*\(/u, 'UI must not collapse duplicate JSON keys before strict import');
});

test('domain, protocol, and compilation stay independent of browser and SillyTavern runtime APIs', () => {
    const violations = [];
    const runtimePattern = /\b(?:window|document|HTMLElement|Element|Node|jQuery|fetch|getContext|setExtensionPrompt|eventSource|event_types|SillyTavern)\b|\$\s*\(/gu;
    for (const [file, source] of sources) {
        if (!/^src\/(?:domain|protocol|compilation)\//.test(file)) continue;
        for (const match of source.matchAll(runtimePattern)) violations.push(`${file} uses ${match[0]}`);
        for (const specifier of importsOf(source)) {
            if (/(?:^|\/)(?:extensions|script)\.js(?:[?#].*)?$/.test(specifier)) {
                violations.push(`${file} imports SillyTavern core ${specifier}`);
            }
        }
    }
    assert.deepEqual(violations, []);
});

test('local import graph obeys v2 layer boundaries and every target exists', () => {
    const forbiddenTargets = {
        ui: new Set(['application', 'persistence', 'host', 'bootstrap', 'domain', 'protocol', 'compilation']),
        domain: new Set(['application', 'persistence', 'host', 'bootstrap', 'ui']),
        protocol: new Set(['application', 'persistence', 'host', 'bootstrap', 'ui']),
        compilation: new Set(['application', 'persistence', 'host', 'bootstrap', 'ui']),
        persistence: new Set(['application', 'host', 'bootstrap', 'ui']),
        io: new Set(['application', 'persistence', 'host', 'bootstrap', 'ui']),
        application: new Set(['host', 'bootstrap', 'ui']),
        host: new Set(['application', 'persistence', 'bootstrap', 'ui']),
    };
    const violations = [];
    for (const [file, source] of sources) {
        const fromLayer = layerOf(file);
        for (const specifier of importsOf(source)) {
            const target = resolveLocalImport(file, specifier);
            if (!target) continue;
            if (target.startsWith('../') && /(?:^|\/)(?:extensions|script)\.js(?:[?#].*)?$/.test(specifier)) continue;
            if (!sources.has(target)) {
                violations.push(`${file} has unresolved local import ${specifier} -> ${target}`);
                continue;
            }
            const toLayer = layerOf(target);
            if (forbiddenTargets[fromLayer]?.has(toLayer)) violations.push(`${file} (${fromLayer}) -> ${target} (${toLayer})`);
        }
    }
    assert.deepEqual(violations, []);
});

test('legacy flat v1 modules are absent from the replacement tree', () => {
    const legacyFiles = [
        'src/application.js',
        'src/context-compiler.js',
        'src/domain.js',
        'src/generation-transaction.js',
        'src/repository.js',
        'src/schema.js',
        'src/sillytavern-adapter.js',
        'src/ui.js',
    ];
    assert.deepEqual(legacyFiles.filter(file => sources.has(file)), []);
});

test('host adapter imports resolve to the official SillyTavern 1.18.0 public modules', () => {
    const adapterFile = [...sources.keys()].find(file => /^src\/host\/sillytavern-adapter\.js$/.test(file));
    assert.ok(adapterFile, 'src/host/sillytavern-adapter.js must exist');
    const installedAdapter = new URL(
        adapterFile,
        'file:///SillyTavern/public/scripts/extensions/third-party/candy-w-rpg-console/',
    );
    const imports = importsOf(sources.get(adapterFile));
    const extensionImport = imports.find(value => /extensions\.js$/.test(value));
    const scriptImport = imports.find(value => /script\.js$/.test(value));
    assert.ok(extensionImport, 'host adapter must import extensions.js');
    assert.ok(scriptImport, 'host adapter must import script.js');
    assert.equal(new URL(extensionImport, installedAdapter).pathname, '/SillyTavern/public/scripts/extensions.js');
    assert.equal(new URL(scriptImport, installedAdapter).pathname, '/SillyTavern/public/script.js');
});

test('host owns exactly two distinct prompt slots: performance directive and native World Info scan seed', () => {
    const source = sources.get('src/host/sillytavern-adapter.js');
    assert.ok(source);
    const directive = /DIRECTIVE_SLOT\s*=\s*(['"])([^'"]+)\1/.exec(source)?.[2];
    const scanSeed = /WORLD_SCAN_SLOT\s*=\s*(['"])([^'"]+)\1/.exec(source)?.[2];
    assert.ok(directive, 'DIRECTIVE_SLOT must be declared');
    assert.ok(scanSeed, 'WORLD_SCAN_SLOT must be declared');
    assert.notEqual(directive, scanSeed);
    assert.match(source, /setExtensionPrompt\(\s*DIRECTIVE_SLOT\s*,[^;]*extension_prompt_types\.IN_PROMPT\s*,\s*0\s*,\s*false\s*,\s*extension_prompt_roles\.SYSTEM\s*\)/s);
    assert.match(source, /setExtensionPrompt\(\s*WORLD_SCAN_SLOT\s*,[^;]*extension_prompt_types\.NONE\s*,\s*0\s*,\s*true\s*,\s*extension_prompt_roles\.SYSTEM\s*\)/s);
    const referencedSlots = new Set(
        [...source.matchAll(/setExtensionPrompt\(\s*([A-Z][A-Z0-9_]*)/g)].map(match => match[1]),
    );
    assert.deepEqual([...referencedSlots].sort(), ['DIRECTIVE_SLOT', 'WORLD_SCAN_SLOT']);
});

test('streaming commit never applies an unmatched host UI lock after MESSAGE_RECEIVED', () => {
    assert.doesNotMatch(sources.get('src/application/director-application.js'), /lockGenerationUi|deactivateSendButtons/u);
    assert.doesNotMatch(sources.get('src/host/sillytavern-adapter.js'), /lockGenerationUi|deactivateSendButtons/u);
});

test('manifest wires the v2 interceptor and official disable cleanup hook', async () => {
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    assert.equal(manifest.generate_interceptor, 'candyWDirectorGenerationInterceptorV2');
    assert.equal(manifest.hooks?.disable, 'disableCandyWDirector');
    assert.match(
        sources.get('index.js') ?? '',
        /\bexport\s+(?:(?:async\s+)?function\s+disableCandyWDirector\b|const\s+disableCandyWDirector\s*=)|\bexport\s*\{[^}]*\bdisableCandyWDirector\b[^}]*\}/s,
    );
});
