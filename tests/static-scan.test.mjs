import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries
        .filter(entry => !['.git', 'node_modules', 'tests', 'docs'].includes(entry.name))
        .map(entry => {
            const absolute = path.join(directory, entry.name);
            return entry.isDirectory() ? walk(absolute) : [absolute];
        }));
    return nested.flat();
}

const scannedFiles = (await walk(root))
    .filter(file => /\.(?:js|json|css|html)$/i.test(file))
    .sort();
const sources = new Map(await Promise.all(scannedFiles.map(async absolute => [
    path.relative(root, absolute).split(path.sep).join('/'),
    await readFile(absolute, 'utf8'),
])));

function hitsFor(pattern) {
    const hits = [];
    for (const [file, source] of sources) {
        pattern.lastIndex = 0;
        for (const match of source.matchAll(pattern)) {
            const line = source.slice(0, match.index).split('\n').length;
            hits.push(`${file}:${line}: ${match[0].slice(0, 100)}`);
        }
    }
    return hits;
}

test('production has no direct network transport, textarea automation, or DOM/event monkey patch', () => {
    const forbidden = [
        /\bfetch\s*\(/gu,
        /\b(?:XMLHttpRequest|WebSocket|EventSource)\s*\(/gu,
        /\bnavigator\s*\.\s*sendBeacon\s*\(/gu,
        /(?:#|['"])?send_textarea\b/giu,
        /\.dispatchEvent\s*\(\s*new\s+(?:InputEvent|KeyboardEvent|MouseEvent|Event)\b/gu,
        /(?:EventTarget|Node|Element|HTMLElement|Document|Window)\.prototype\s*\./gu,
        /Object\.(?:defineProperty|defineProperties|setPrototypeOf)\s*\(\s*(?:EventTarget|Node|Element|HTMLElement|Document|Window)\.prototype/gu,
        /\b(?:onclick|onsubmit|oninput|onkeydown)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/gu,
        /\b(?:eval|Function)\s*\(/gu,
    ];
    assert.deepEqual(forbidden.flatMap(hitsFor), []);
});

test('production contains no provider endpoint, credential storage, embedded key, or real API escape hatch', () => {
    const forbidden = [
        /https?:\/\/(?:api\.)?(?:openai\.com|anthropic\.com|openrouter\.ai|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.cohere\.ai)\b/giu,
        /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|bearer[_-]?token)\b/giu,
        /\b(?:localStorage|sessionStorage)\s*\.\s*setItem\s*\([^)]*(?:key|token|secret)/giu,
        /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/gu,
        /\b(?:OPENAI|ANTHROPIC|OPENROUTER|GEMINI|MISTRAL|COHERE)_API_KEY\b/gu,
    ];
    assert.deepEqual(forbidden.flatMap(hitsFor), []);
});

test('production is portable and contains no absolute user or machine path', () => {
    const forbidden = [
        /(?:^|[\s'"`=(])\/(?:Users|home)\/[A-Za-z0-9._-]+\//gmu,
        /(?:^|[\s'"`=(])\/Volumes\/[A-Za-z0-9._ -]+\//gmu,
        /[A-Za-z]:\\Users\\[^\\\s'"`]+\\/gu,
        /file:\/\/\/(?:Users|home|Volumes)\//gu,
    ];
    assert.deepEqual(forbidden.flatMap(hitsFor), []);
});

test('complete v2 replacement contains no v1 schema, metadata, prompt slot, or compatibility path', () => {
    const forbidden = [
        /candy[_-]w[_-]rpg[_-]console[_-]v1/giu,
        /candy-w-rpg-console\/v1/giu,
        /candy-w-rpg-console\.v1\.[A-Za-z0-9_.-]+/giu,
        /\b(?:legacy|backward[_ -]?compat(?:ibility)?|v1[_ -]?compat(?:ibility)?|migrateV1|fromV1)\b/giu,
    ];
    assert.deepEqual(forbidden.flatMap(hitsFor), []);
});

test('production exposes no fake adapter, mock mode, fixture mode, or test-only backdoor', () => {
    const forbidden = [
        /\b(?:Fake|Mock|Stub)(?:SillyTavern)?Adapter\b/gu,
        /\b(?:fake|mock|stub|fixture)[_-]?(?:mode|provider|response|generation|adapter)\b/giu,
        /\b(?:__test__|__testing__|testOnly|testingOnly|FOR_TESTS_ONLY)\b/gu,
        /\bprocess\.env\.NODE_ENV\s*={2,3}\s*['"]test['"]/gu,
        /[?&](?:fake|mock|testMode)=/giu,
    ];
    assert.deepEqual(forbidden.flatMap(hitsFor), []);
});

test('manifest stays a v2-only SillyTavern extension without external requirements', () => {
    const manifest = JSON.parse(sources.get('manifest.json'));
    assert.equal(manifest.version.split('.')[0], '2');
    assert.equal(manifest.minimum_client_version, '1.18.0');
    assert.deepEqual(manifest.requires, []);
    assert.deepEqual(manifest.optional, []);
    assert.equal(manifest.js, 'index.js');
    assert.equal(manifest.generate_interceptor, 'candyWDirectorGenerationInterceptorV2');
    assert.equal(manifest.hooks?.disable, 'disableCandyWDirector');
});
