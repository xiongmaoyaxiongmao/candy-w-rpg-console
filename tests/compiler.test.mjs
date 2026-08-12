import assert from 'node:assert/strict';
import {
    ContextBudgetError,
    compileContextBudget,
    compileWorldInfoScanSeed,
} from '../src/compilation/index.js';

assert.equal(
    compileWorldInfoScanSeed(['  Ａlice  ', 'alice', '钟楼', '旧港', '钟楼']),
    'Alice\n钟楼\n旧港',
    'scan seed normalization and de-duplication preserve first-seen order',
);
assert.equal(
    compileWorldInfoScanSeed(['第一锚点', '第二锚点', '短'], { maxAnchors: 2, maxChars: 9 }),
    '第一锚点\n第二锚点',
);
assert.equal(
    compileWorldInfoScanSeed(['很长的第一锚点', '短'], { maxChars: 2 }),
    '',
    'the highest-priority prefix is kept; a non-fitting anchor is never split or skipped around',
);
assert.throws(
    () => compileWorldInfoScanSeed([{ text: '幕后地点', visibility: 'hidden' }]),
    /必须是字符串/,
    'visibility-bearing scenario anchors cannot be passed in place of the public projection',
);
assert.throws(() => compileWorldInfoScanSeed(['钟楼'], { hiddenAnchors: ['地窖'] }), /未知字段/);

const complete = compileContextBudget({
    head: [{ id: 'head', text: 'HEAD' }],
    optional: [{ id: 'a', text: 'AAAA' }, { id: 'b', text: 'BBBBBBBB' }],
    tail: [{ id: 'tail', text: 'TAIL' }],
}, { maxChars: 100, omissionLabel: '省{count}' });
assert.equal(complete.text, 'HEAD\nAAAA\nBBBBBBBB\nTAIL');
assert.equal(complete.truncated, false);
assert.deepEqual(complete.includedOptionalIds, ['a', 'b']);

const clipped = compileContextBudget({
    head: [{ id: 'head', text: 'HEAD' }],
    optional: [{ id: 'a', text: 'AAAA' }, { id: 'b', text: 'BBBBBBBB' }],
    tail: [{ id: 'tail', text: 'TAIL' }],
}, { maxChars: 17, omissionLabel: '省{count}' });
assert.equal(clipped.text, 'HEAD\nAAAA\n省1\nTAIL');
assert.equal(clipped.truncated, true);
assert.deepEqual(clipped.includedOptionalIds, ['a']);
assert.deepEqual(clipped.omittedOptionalIds, ['b']);
assert.ok(clipped.text.length <= 17);

assert.throws(
    () => compileContextBudget({
        head: [{ id: 'head', text: '1234567890' }],
        optional: [{ id: 'optional', text: 'X' }],
        tail: [{ id: 'tail', text: '1234567890' }],
    }, { maxChars: 21, omissionLabel: '省{count}' }),
    error => error instanceof ContextBudgetError
        && error.code === 'CONTEXT_BUDGET_EXCEEDED'
        && error.details.mandatoryLength === 21,
    'mandatory context is never silently truncated when even the omission marker cannot fit',
);
assert.throws(
    () => compileContextBudget({
        head: [{ id: 'same', text: 'A' }],
        optional: [],
        tail: [{ id: 'same', text: 'B' }],
    }),
    /id 必须唯一/,
);
assert.throws(
    () => compileContextBudget({ head: [], optional: [], tail: [], state: {} }),
    /未知字段/,
);
assert.throws(
    () => compileContextBudget({ head: [], optional: [], tail: [] }, { maxChars: 10, omissionLabel: 'silent' }),
    /\{count\}/,
);

console.log('compiler tests passed');
