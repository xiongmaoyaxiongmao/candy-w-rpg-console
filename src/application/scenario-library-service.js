import { buildScenarioContextIndex } from '../domain/scenario-context.js';
import { analyzeScenarioGraph } from '../domain/scenario-graph.js';
import { assertScenario, finalizeScenario, validateScenario } from '../domain/scenario-schema.js';
import { scenarioContentSections, editScenarioContent, nextScenarioVersion } from '../domain/scenario-content.js';
import { exportScenarioPackage } from '../io/index.js';
import { defaultScenarioSetup, validateSetupFields } from '../domain/scenario-setup.js';

export class ScenarioLibraryService {
    constructor({adapter,builtIns,changed}) { Object.assign(this,{adapter,builtIns,changed}); }
    list(){const map=new Map(this.builtIns.map(s=>[s.id,s]));for(const s of this.adapter.getSettings().importedScenarios??[])if(validateScenario(s)&&analyzeScenarioGraph(s).isComplete&&!this.builtIns.some(b=>b.id===s.id))map.set(s.id,s);return [...map.values()].filter(s=>!this.builtIns.some(b=>b.id===s.id)||!(this.adapter.getSettings().deletedScenarios??[]).some(d=>d.scenario.id===s.id));}
    get(id){const s=this.list().find(s=>s.id===id);if(!s)throw new Error('剧本库中找不到这个剧本。');return assertScenario(s);}
    document(scenario, source='library') {const s=assertScenario(scenario);const builtin=this.builtIns.some(b=>b.id===s.id);return {id:s.id,hash:s.hash,title:s.public.title,version:s.contentVersion,source,editable:source==='library'&&!builtin,builtin,canRestore:source==='library'&&(this.adapter.getSettings().scenarioBackups??[]).some(b=>b.id===s.id),sections:scenarioContentSections(s)};}
    async persist(settings){
        const previous = this.adapter.getSettings();
        settings.contextIndexes = { ...previous.contextIndexes, ...settings.contextIndexes };
        for (const scenario of settings.importedScenarios ?? []) {
            if (settings.contextIndexes[scenario.hash]) continue;
            const old = (previous.importedScenarios ?? []).find(s => s.id === scenario.id);
            const job = (previous.authoringJobs ?? []).find(j => j.review?.hash === scenario.hash);
            const prior = job?.plan ? { scenes: Object.fromEntries(job.plan.scenePlans.map(s => [s.id, s.context])) } : old ? settings.contextIndexes[old.hash] : null;
            settings.contextIndexes[scenario.hash] = buildScenarioContextIndex(scenario, prior ? { ...prior, version: 1, scenarioHash: scenario.hash } : null);
        }
        if(this.adapter.persistApiSettings)await this.adapter.persistApiSettings(settings);else await this.adapter.saveSettings(settings);}
    setup(id) {
        this.get(id);
        const value = (this.adapter.getSettings().scenarioSetups ?? []).find(s => s.scenarioId === id);
        if (!value) return { scenarioId: id, revision: null, ...defaultScenarioSetup() };
        if (!Number.isSafeInteger(value.revision) || value.revision < 1 || !validateSetupFields(value.playerDraft, value.playerEntries)) throw new Error('这个剧本的开局设置无法读取，原记录仍保留。');
        return structuredClone(value);
    }
    async saveSetup({ scenarioId, playerDraft, playerEntries, expectedRevision = null }) {
        const current = this.setup(scenarioId);
        if (current.revision !== expectedRevision) throw new Error('剧本设置已经更新，请重新打开“设置与绑定”后修改。');
        if (!validateSetupFields(playerDraft, playerEntries)) throw new Error('请检查设置中的文字长度、数值和规则项目；未填写完的设置也可以保存。');
        const saved = { scenarioId, revision: (current.revision ?? 0) + 1, playerDraft: structuredClone(playerDraft), playerEntries: structuredClone(playerEntries) };
        const settings = this.adapter.getSettings();
        await this.persist({ ...settings, scenarioSetups: [...(settings.scenarioSetups ?? []).filter(s => s.scenarioId !== scenarioId), saved] });
        return structuredClone(saved);
    }
    async save(candidate, expectedHash, removeJobId){
        const checked=assertScenario(candidate), current=this.get(checked.id);
        if(!analyzeScenarioGraph(checked).isComplete)throw new Error('修改后的剧本不完整，没有保存。');
        if(this.builtIns.some(s=>s.id===checked.id))throw new Error('内置剧本请先另存副本，再修改。');
        if(current.hash!==expectedHash)throw new Error('剧本已被其他修改更新，请重新打开最新版；本次修改还没有覆盖它。');
        const settings=this.adapter.getSettings();
        const next={...settings,importedScenarios:(settings.importedScenarios??[]).map(s=>s.id===checked.id?checked:s),scenarioBackups:[...(settings.scenarioBackups??[]).filter(s=>s.id!==checked.id),current],...(removeJobId?{authoringJobs:(settings.authoringJobs??[]).filter(j=>j.id!==removeJobId)}:{})};
        await this.persist(next);this.changed(checked);return {...this.document(checked),notice:'已保存到剧本库，上一版已保留，可随时恢复。'};
    }
    deleted(){return (this.adapter.getSettings().deletedScenarios??[]).map(d=>({id:d.scenario.id,title:d.scenario.public.title}));}
    async remove({id,expectedHash}) {
        const scenario=this.get(id);if(scenario.hash!==expectedHash)throw new Error('剧本已更新，请重新打开后删除。');
        const settings=this.adapter.getSettings();
        await this.persist({...settings,importedScenarios:(settings.importedScenarios??[]).filter(s=>s.id!==id),deletedScenarios:[...(settings.deletedScenarios??[]),{scenario,deletedAt:new Date().toISOString()}]});
        this.changed();
    }
    async restoreDeleted(id) {
        const settings=this.adapter.getSettings(),entry=(settings.deletedScenarios??[]).find(d=>d.scenario.id===id);
        if(!entry)throw new Error('这个剧本已恢复或不在已删除列表中。');
        if((settings.importedScenarios??[]).some(s=>s.id===id))throw new Error('存在同编号的新剧本，请先另存该剧本，避免覆盖。');
        await this.persist({...settings,deletedScenarios:settings.deletedScenarios.filter(d=>d!==entry),importedScenarios:this.builtIns.some(s=>s.id===id)?settings.importedScenarios:[...(settings.importedScenarios??[]),entry.scenario]});this.changed();
    }
    async edit({id,expectedHash,changes}){const current=this.get(id);if(current.hash!==expectedHash)throw new Error('剧本已更新，请重新打开后编辑。');return this.save(editScenarioContent(current,changes),expectedHash);}
    async copy(scenario, removeJobId){const draft=structuredClone(assertScenario(scenario));delete draft.hash;draft.id=`copy-${draft.id.slice(0,35)}-${globalThis.crypto.randomUUID().slice(0,8)}`;draft.contentVersion='1.0.0';draft.public.title=`${draft.public.title.slice(0,115)} · 副本`;const copy=finalizeScenario(draft);const settings=this.adapter.getSettings();await this.persist({...settings,importedScenarios:[...(settings.importedScenarios??[]),copy],...(removeJobId?{authoringJobs:(settings.authoringJobs??[]).filter(j=>j.id!==removeJobId)}:{})});this.changed(copy);return this.document(copy);}
    async restore({id,expectedHash}){const old=(this.adapter.getSettings().scenarioBackups??[]).find(s=>s.id===id);if(!old)throw new Error('没有可恢复的上一版。');const draft=structuredClone(assertScenario(old));delete draft.hash;draft.contentVersion=nextScenarioVersion(this.get(id).contentVersion);return this.save(finalizeScenario(draft),expectedHash);}
    export(scenario){return exportScenarioPackage(scenario);}
}
