import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectorApplication } from '../src/application/index.js';
import { PerChatRepository } from '../src/persistence/per-chat-repository.js';
import { validateDirectorState, validateScenario } from '../src/domain/index.js';
import { createProgression, playerEntryIssues } from '../src/domain/player-progression.js';
import { defaultScenarioSetup } from '../src/domain/scenario-setup.js';
import { validateGeneratedPlayerDraft } from '../src/protocol/player-generation.js';
import { DirectorUi } from '../src/ui/controller.js';
import { renderPlayerEntries } from '../src/ui/player-progression.js';
import { FOG_HARBOR_SCENARIO as scenario } from '../src/scenarios/index.js';
import { FakeOfficialAdapter } from './support/fake-official-adapter.mjs';
import { generatedPlayer } from './support/player-fixture.mjs';

const draft = () => { const value = generatedPlayer(); value.entries[1].name = '强作镇定'; value.entries[1].rules[0].delta = 0; return value; };
function harness() {
    const adapter = new FakeOfficialAdapter(); adapter.selectSingle(); adapter.currentPersona = () => ({ name: '林雨' });
    const repository = new PerChatRepository({ adapter, validateState: validateDirectorState, validateScenario });
    return { adapter, repository, app: new DirectorApplication({ adapter, repository }).start() };
}

test('semantic errors remain in editable generated drafts and identify the affected field', () => {
    const value = draft();
    assert.equal(validateGeneratedPlayerDraft(value), value);
    assert.equal(value.entries[1].rules[0].delta, 0);
    const issue = playerEntryIssues(value.entries)[0];
    assert.equal(issue.entryId, 'p_fire'); assert.equal(issue.field, 'p_practice.delta');
    assert.match(issue.message, /强作镇定：第 1 条.*不能为 0/);
    assert.throws(() => createProgression(value.entries), /不能为 0/);
    assert.match(renderPlayerEntries(value.entries, true, playerEntryIssues(value.entries)), /修改这一项/);
    assert.match(renderPlayerEntries(value.entries, true, playerEntryIssues(value.entries)), /草稿可以保存/);
    value.entries[1].rules[0].delta = 2; value.entries[1].rules[0].condition = '';
    assert.equal(validateGeneratedPlayerDraft(value), value);
    assert.equal(playerEntryIssues(value.entries)[0].field, 'p_practice.condition');
    value.entries[1].rules[0].condition = '完成一次有效的练习';
    assert.deepEqual(playerEntryIssues(value.entries), []);
    assert.doesNotThrow(() => createProgression(value.entries));
    const malformed = draft(); malformed.entries[1].rules[0].timing = 'tomorrow';
    assert.throws(() => validateGeneratedPlayerDraft(malformed));
    const duplicate = draft(); duplicate.entries[1].id = duplicate.entries[0].id;
    assert.throws(() => validateGeneratedPlayerDraft(duplicate), /编号或结构/);
});

test('manual generation preserves existing settings until saving and unfinished drafts survive reload without binding', async () => {
    const { adapter, repository, app } = harness();
    try {
        const playerDraft = { ...defaultScenarioSetup().playerDraft, playerName: '林雨' };
        await app.saveScenarioSetup({ scenarioId: scenario.id, playerDraft, playerEntries: generatedPlayer().entries });
        const previous = structuredClone(adapter.settings);
        adapter.enqueueRaw(JSON.stringify(draft()));
        const entries = await app.generateScenarioPlayerEntries({ scenarioId: scenario.id, playerDraft, playerEntries: generatedPlayer().entries });
        assert.equal(entries[1].rules[0].delta, 0);
        assert.deepEqual(adapter.settings, previous);
        await app.saveScenarioSetup({ scenarioId: scenario.id, playerDraft, playerEntries: entries, expectedRevision: 1 });
        const fresh = new DirectorApplication({ adapter, repository });
        assert.equal(fresh.getScenarioSetup(scenario.id).playerEntries[1].rules[0].delta, 0);
        await assert.rejects(app.bindScenarioToCurrentChat({ scenarioId: scenario.id, campaignKey: app.getScenarioContextKey() }), /不能为 0/);
        assert.equal(repository.load(), null);
        entries[1].rules[0].delta = 2;
        await app.saveScenarioSetup({ scenarioId: scenario.id, playerDraft, playerEntries: entries, expectedRevision: 2 });
        await app.bindScenarioToCurrentChat({ scenarioId: scenario.id, campaignKey: app.getScenarioContextKey() });
        assert.equal(repository.load().player.progression.entries[1].rules[0].delta, 2);
    } finally { await app.destroy(); }
});

test('finished story generation publishes reviewable setup drafts and takes the user to the affected entries', async () => {
    const { adapter, repository, app } = harness();
    try {
        const authored = structuredClone(scenario); delete authored.hash; authored.id = 'review-draft-story';
        adapter.enqueueScenario(authored, { includePlayer: false }); adapter.enqueueRaw(JSON.stringify(draft()));
        const result = await app.writeCustomScenario({ title: '灯塔', premise: '在风暴中抵达灯塔。', tone: '悬疑', setting: '海港', opening: '风暴即将到来。', coreTruth: '灯塔电路被破坏。', npcGoals: '修复灯塔。', timePressure: '风暴迫近。', endings: '修复或撤离。' });
        assert.equal(result.id, authored.id); assert.equal(app.getAuthoringJob(), null);
        assert.equal(app.getScenarioSetup(result.id).playerEntries[1].rules[0].delta, 0);
        assert.equal(adapter.rawPrompts.length, authored.scenes.length + 2);
        const ui = new DirectorUi(app); await ui.afterAuthoring(result);
        assert.equal(ui.screen, 'player'); assert.equal(ui.selectedScenarioId, result.id);
        assert.match(ui.setupNotice, /剧本已生成/); assert.equal(ui.playerEntries[1].rules[0].delta, 0);
        assert.equal(repository.load(), null);
    } finally { await app.destroy(); }
});
