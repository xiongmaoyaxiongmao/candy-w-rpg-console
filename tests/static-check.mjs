import { access, readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['.git', 'node_modules']);

async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await walk(path));
        else if (entry.isFile()) files.push(path);
    }
    return files;
}

function checkSyntax(path) {
    const result = spawnSync(process.execPath, ['--check', path], {
        cwd: root,
        encoding: 'utf8',
        env: process.env,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        const detail = `${result.stderr || result.stdout}`.trim();
        throw new Error(`${relative(root, path)} 语法检查失败：\n${detail}`);
    }
}

function assertString(value, label) {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} 必须是非空字符串。`);
}

async function checkManifest(manifest) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('manifest.json 必须是对象。');
    for (const key of ['display_name', 'js', 'css', 'author', 'version']) assertString(manifest[key], `manifest.${key}`);
    if (!Number.isSafeInteger(manifest.loading_order)) throw new Error('manifest.loading_order 必须是安全整数。');
    if (!Array.isArray(manifest.requires) || !Array.isArray(manifest.optional)) throw new Error('manifest requires/optional 必须是数组。');
    if (manifest.generate_interceptor !== undefined) assertString(manifest.generate_interceptor, 'manifest.generate_interceptor');
    if (manifest.hooks !== undefined && (!manifest.hooks || typeof manifest.hooks !== 'object' || Array.isArray(manifest.hooks))) {
        throw new Error('manifest.hooks 必须是对象。');
    }
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)) throw new Error('manifest.version 必须是语义版本。');
    for (const key of ['js', 'css']) {
        if (manifest[key].startsWith('/') || manifest[key].split(/[\\/]/u).includes('..')) {
            throw new Error(`manifest.${key} 必须是扩展目录内的相对路径。`);
        }
        try { await access(join(root, manifest[key])); }
        catch { throw new Error(`manifest.${key} 指向的文件不存在。`); }
    }
}

const files = await walk(root);
const javascriptFiles = files.filter(path => ['.js', '.mjs'].includes(extname(path)));
const jsonFiles = files.filter(path => extname(path) === '.json');

for (const path of javascriptFiles) checkSyntax(path);
for (const path of jsonFiles) {
    let parsed;
    try { parsed = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { throw new Error(`${relative(root, path)} 不是合法 JSON：${error.message}`); }
    if (path === join(root, 'manifest.json')) await checkManifest(parsed);
}

console.log(`static check passed: ${javascriptFiles.length} JavaScript files, ${jsonFiles.length} JSON files`);
