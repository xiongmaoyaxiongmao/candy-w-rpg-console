import { assertKeyShape, assertSafeInteger, cleanText } from '../protocol/validation.js';

export const DEFAULT_SCAN_SEED_MAX_ANCHORS = 24;
export const DEFAULT_SCAN_SEED_MAX_CHARS = 1200;

/**
 * Compile only the caller's public anchor projection into an ST World Info scan
 * seed. No scenario, director state, entry body, or visibility-bearing object is
 * accepted by this boundary.
 *
 * Duplicates are removed by NFKC + case-insensitive comparison while preserving
 * the first spelling and order. Limits keep the highest-priority prefix; an
 * anchor is never cut in half.
 */
export function compileWorldInfoScanSeed(publicAnchors, options = {}) {
    if (!Array.isArray(publicAnchors)) throw new TypeError('publicAnchors 必须是公开锚点字符串数组。');
    assertKeyShape(options, { required: [], optional: ['maxAnchors', 'maxChars'] }, 'World Info scan seed 选项');
    const maxAnchors = Object.prototype.hasOwnProperty.call(options, 'maxAnchors')
        ? assertSafeInteger(options.maxAnchors, 'maxAnchors', { min: 1, max: 128 })
        : DEFAULT_SCAN_SEED_MAX_ANCHORS;
    const maxChars = Object.prototype.hasOwnProperty.call(options, 'maxChars')
        ? assertSafeInteger(options.maxChars, 'maxChars', { min: 1, max: 10000 })
        : DEFAULT_SCAN_SEED_MAX_CHARS;
    if (publicAnchors.length > 512) throw new TypeError('publicAnchors 最多接受 512 项候选锚点。');

    const seen = new Set();
    const selected = [];
    let length = 0;
    for (let index = 0; index < publicAnchors.length; index += 1) {
        const anchor = cleanText(publicAnchors[index], {
            label: `publicAnchors[${index}]`,
            minChars: 1,
            maxChars: 160,
        }).replace(/\s+/gu, ' ');
        const duplicateKey = anchor.toLowerCase();
        if (seen.has(duplicateKey)) continue;
        seen.add(duplicateKey);
        if (selected.length >= maxAnchors) break;
        const nextLength = length + (selected.length > 0 ? 1 : 0) + anchor.length;
        if (nextLength > maxChars) break;
        selected.push(anchor);
        length = nextLength;
    }
    return selected.join('\n');
}
