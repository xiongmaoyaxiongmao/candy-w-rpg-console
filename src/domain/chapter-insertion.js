import { object, text, integer, list, assertContract } from './json-contract.js';
import { finalizeScenario } from './scenario-schema.js';
import { nextScenarioVersion } from './scenario-content.js';
import { stateMatchesScenario } from './director-state.js';
export const CHAPTER_CONTRACT = object({title:text(120),summary:text(600),connection:text(400),scenes:list(object({title:text(120),description:text(800),location:text(160),timeLabel:text(120),objective:text(500),action:text(120),consequence:text(600),minutes:integer(0,240)}),8,1)});
export function validateChapter(value) { assertContract(value,CHAPTER_CONTRACT,'新增章节'); return structuredClone(value); }
const move = (id,label,description,nextSceneId,endingId=null) => ({id,label,description:description.slice(0,400),clockAdvance:0,attribute:null,checkId:null,conditions:{allFacts:[],anyFacts:[],notFacts:[]},mustHappen:[description],revealSecretIds:[],publicPatch:{objective:null,knownPeopleIds:[],knownClueIds:[],itemIds:[],crisisIds:[]},hiddenPatch:{occurredFactIds:[],setVariables:{}},nextSceneId,endingId});
export function insertChapter(scenario,state,input) {
    const draft=validateChapter(input.chapter);
    if(!['now','after'].includes(input.mode)) throw new Error('请选择接入时机。');
    const next=structuredClone(scenario), current=next.scenes.find(s=>s.id===state.hidden.currentSceneId);
    const prefix='extra_'+globalThis.crypto.randomUUID().replaceAll('-','').slice(0,16), actId=prefix+'_act';
    const ids=draft.scenes.map((_,i)=>prefix+'_s'+i), routes=[];
    if(input.mode==='now') {
        if(!next.scenes.some(s=>s.id===input.returnSceneId)) throw new Error('请选择新增章节结束后返回的场景。');
        if(current.moves.length>=24) throw new Error('当前场景的行动已满，请选择章节结束后接入。');
        current.moves.push(move(prefix+'_entry','进入新增章节',draft.connection,ids[0]));
        routes.push({nextSceneId:input.returnSceneId,endingId:null,fact:null});
    } else {
        const exits=next.scenes.filter(s=>s.actId===current.actId).flatMap(s=>s.moves).filter(m=>!m.checkId&&(m.endingId||m.nextSceneId&&next.scenes.find(s=>s.id===m.nextSceneId)?.actId!==current.actId));
        if(!exits.length) throw new Error('当前章节没有通往下一章节或结局的出口，请选择立即接入。');
        if(exits.length>24) throw new Error('当前章节出口超过 24 条，无法一次插入，请选择立即接入。');
        exits.forEach((exit,i)=>{
            const fact=prefix+'_route'+i;
            next.coreFacts.push({id:fact,text:'新增章节接续路线 '+(i+1)});
            routes.push({nextSceneId:exit.nextSceneId,endingId:exit.endingId,fact,original:structuredClone(exit)});
            exit.hiddenPatch={occurredFactIds:[fact],setVariables:{}};
            exit.revealSecretIds=[];
            exit.publicPatch={objective:null,knownPeopleIds:[],knownClueIds:[],itemIds:[],crisisIds:[]};
            exit.nextSceneId=ids[0];exit.endingId=null;
            exit.publicPatch.objective=draft.scenes[0].objective;
            exit.mustHappen=[draft.connection+'；先进入新增章节，原定目的地或结局在该章节结束后兑现。'];
        });
    }
    const act=next.acts.find(a=>a.id===current.actId), number=act.number+1;
    next.acts.forEach(a=>{if(a.number>=number)a.number++;});
    next.acts.push({id:actId,number,title:draft.title,summary:draft.summary,sceneIds:ids});
    next.acts.sort((a,b)=>a.number-b.number);
    draft.scenes.forEach((s,i)=>{
        const moves=i<ids.length-1?[move(prefix+'_m'+i,s.action,s.consequence,ids[i+1])]:routes.map((r,j)=>{
            const m=move(prefix+'_return'+j,s.action,s.consequence,r.nextSceneId,r.endingId);
            if(r.fact)m.conditions.allFacts=[r.fact];
            if(r.original){if(r.original.mustHappen.length>=24)throw new Error('原出口后果已满，请选择立即接入。');m.mustHappen=[s.consequence,...r.original.mustHappen];m.hiddenPatch=structuredClone(r.original.hiddenPatch);m.publicPatch=structuredClone(r.original.publicPatch);m.revealSecretIds=[...r.original.revealSecretIds];}
            return m;
        });
        moves.forEach(m=>m.clockAdvance=s.minutes);
        next.scenes.push({id:ids[i],actId,title:s.title,description:s.description,location:s.location,timeLabel:s.timeLabel,objective:s.objective,anchors:[],entryFacts:[],moves});
    });
    next.contentVersion=nextScenarioVersion(next.contentVersion);
    const result=finalizeScenario(next), updated=structuredClone(state);
    updated.scenario.hash=result.hash;updated.revision++;
    if(input.mode==='now') {
        const s=result.scenes.find(s=>s.id===ids[0]);
        updated.hidden.currentSceneId=s.id;updated.hidden.visitedSceneIds.push(s.id);
        updated.public.scene={id:s.id,title:s.title,description:s.description,location:s.location,timeLabel:s.timeLabel};
        updated.public.act={id:actId,number,title:draft.title,summary:draft.summary};updated.public.objective=s.objective;
    }
    if(!stateMatchesScenario(updated,result))throw new Error('章节接入与当前旅程不一致，未保存。');
    return {scenario:result,state:updated};
}
