import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runGenerationTransaction } from '../src/generation-transaction.js';

const events = new EventEmitter();
for (let index = 0; index < 3; index += 1) {
    assert.equal(String(await runGenerationTransaction({ eventSource: events, stoppedEvent: 'stopped', generate: async () => new String('正式回复') })), '正式回复');
    assert.equal(events.listenerCount('stopped'), 0, 'successful requests leave no stopped listener');
}
await assert.rejects(runGenerationTransaction({ eventSource: events, stoppedEvent: 'stopped', generate: async () => events.emit('stopped') }), /已停止/);
assert.equal(events.listenerCount('stopped'), 0, 'stopped requests leave no listener');
await assert.rejects(runGenerationTransaction({ eventSource: events, stoppedEvent: 'stopped', generate: async () => { throw new Error('backend failed'); } }), /backend failed/);
assert.equal(events.listenerCount('stopped'), 0, 'failed requests leave no listener');
await assert.rejects(runGenerationTransaction({ eventSource: events, stoppedEvent: 'stopped', generate: async () => undefined }), /没有生成正式回复/);
assert.equal(events.listenerCount('stopped'), 0, 'early return leaves no listener');
console.log('generation transaction tests passed');
