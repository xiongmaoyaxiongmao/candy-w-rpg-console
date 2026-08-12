import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectorUi, campaignInputFromFormData } from '../src/ui/controller.js';

class FakeApplication {
    constructor() {
        this.listeners = new Set();
        this.view = { enabled: true, host: { kind: 'single' }, phase: 'empty' };
        this.calls = [];
    }
    subscribe(callback) { this.listeners.add(callback); return () => this.listeners.delete(callback); }
    getViewModel() { return this.view; }
    listScenarios() { return [{ id: 'story', title: '故事' }]; }
    async createCampaign(input) { this.calls.push(['createCampaign', input]); }
    async enterWorld() { this.calls.push(['enterWorld']); }
    async rollPendingCheck() { this.calls.push(['rollPendingCheck']); }
    async retryPending() { this.calls.push(['retryPending']); }
    async cancelPending() { this.calls.push(['cancelPending']); }
    async endCampaign() { this.calls.push(['endCampaign']); }
    async importScenario(input) { this.calls.push(['importScenario', input]); }
    async importSave(input) { this.calls.push(['importSave', input]); }
    exportSave() { this.calls.push(['exportSave']); return { format: 'save' }; }
    setEnabled(enabled) { this.calls.push(['setEnabled', enabled]); }
}

test('campaign form parser sends the frozen player contract', () => {
    const form = new FormData();
    form.set('scenarioId', 'story');
    form.set('playerName', ' 林晚 ');
    form.set('playerConcept', ' 调查记者 ');
    form.set('playerRelationship', ' 七年未见的旧友 ');
    form.set('attributeBody', '2');
    form.set('attributeInsight', '1');
    form.set('attributeRapport', '0');
    assert.deepEqual(campaignInputFromFormData(form), {
        scenarioId: 'story',
        player: {
            name: '林晚',
            concept: '调查记者',
            relationship: '七年未见的旧友',
            attributes: { body: 2, insight: 1, rapport: 0 },
        },
    });
});

test('campaign form parser rejects duplicate attribute values', () => {
    const form = new FormData();
    form.set('scenarioId', 'story');
    form.set('playerName', '林晚');
    form.set('attributeBody', '2');
    form.set('attributeInsight', '2');
    form.set('attributeRapport', '0');
    assert.throws(() => campaignInputFromFormData(form), /各分配一次/);
});

test('controller invokes only the application command contract', async () => {
    const originalWindow = globalThis.window;
    globalThis.window = { confirm: () => true };
    try {
        const app = new FakeApplication();
        const ui = new DirectorUi(app);
        await ui.perform('select-scenario', { scenarioId: 'story' });
        assert.equal(ui.screen, 'player');
        await ui.perform('enter-world');
        await ui.perform('roll-check');
        await ui.perform('retry-pending');
        await ui.perform('cancel-pending');
        await ui.perform('end-campaign');
        await ui.perform('enable');
        assert.deepEqual(app.calls, [
            ['enterWorld'],
            ['rollPendingCheck'],
            ['retryPending'],
            ['cancelPending'],
            ['endCampaign'],
            ['setEnabled', true],
        ]);
        assert.equal(Object.hasOwn(ui, 'adapter'), false);
        assert.equal(Object.hasOwn(ui, 'repository'), false);
    } finally {
        globalThis.window = originalWindow;
    }
});

test('entering another story from an ending clears the completed per-chat campaign first', async () => {
    const calls = [];
    const application = {
        getViewModel: () => ({ enabled: true, host: { kind: 'single' }, phase: 'ended' }),
        subscribe: () => () => {},
        listScenarios: () => [],
        endCampaign: async () => calls.push('endCampaign'),
    };
    const ui = new DirectorUi(application);
    ui.render = () => {};
    await ui.perform('show-scenarios');
    assert.deepEqual(calls, ['endCampaign']);
    assert.equal(ui.screen, 'scenarios');
});
