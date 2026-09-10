import { assertScenario, finalizeScenario } from './scenario-schema.js';
import { analyzeScenarioGraph } from './scenario-graph.js';
import { assertContract } from './json-contract.js';
import { SCENARIO_DRAFT_CONTRACT } from './scenario-contract.js';

export function nextScenarioVersion(version) {
    const parts = version.split('.').map(Number);
    if (parts.length !== 3 || parts.some(n => !Number.isSafeInteger(n)) || !Number.isSafeInteger(parts[2] + 1)) throw new Error('剧本版本无法递增。');
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

/** Author-only reading projection. Never add this projection to the player view or performance. */
export function scenarioContentSections(input) {
    const s = assertScenario(input), sections = [];
    const at = path => path.reduce((value, key) => value[key], s);
    const section = (title, group, open = false) => { const item = { title, group, open, fields: [] }; sections.push(item); return item; };
    const field = (item, path, label, type = 'text', fallbackMax = 800) => {
        let definition = SCENARIO_DRAFT_CONTRACT;
        for (const key of path) definition = typeof key === 'number' ? definition.items : definition.properties[key];
        if (definition.anyOf) definition = definition.anyOf.find(d => d.type !== 'null');
        const max = type === 'lines' ? definition.items.maxLength : type === 'number' ? definition.maximum : definition.maxLength;
        item.fields.push({ key: path.join('.'), path, label, type, max: max ?? fallbackMax, value: at(path) });
    };
    const read = (item, label, value) => item.fields.push({ label, type: 'read', value: String(value || '无') });
    const fields = (item, prefix, spec) => spec.forEach(([key, label, type, max]) => field(item, [...prefix, key], label, type, max));
    const names = new Map([...s.scenes, ...s.npcs, ...s.secrets, ...s.endings, ...Object.values(s.knowledge).flat(), ...s.scenes.flatMap(c => c.moves), ...s.checks].map(v => [v.id, v.name || v.title || v.label || v.reason]));
    const factNames = new Map(s.coreFacts.map(f => [f.id, f.text]));
    const named = ids => ids.map(id => names.get(id) || factNames.get(id) || id).join('；');
    const variables = value => Object.entries(value).map(([key, v]) => `${key} = ${String(v)}`).join('；');
    const overview = section('故事概览', '概览', true);
    fields(overview, ['public'], [['title','剧本名称','text',120],['tagline','一句话介绍','text',240],['summary','故事简介','text',1200],['tone','故事氛围','text',120],['symbol','封面符号','text',16],['tags','故事标签','lines',40]]);
    field(overview, ['startSceneId'], '从这里开场', 'scene', 80);
    overview.fields.at(-1).options = s.scenes.map((scene, index) => ({ value: scene.id, label: scene.title, titleKey: `scenes.${index}.title` }));
    s.acts.forEach((a,i) => { const item=section(`第 ${a.number} 章 · ${a.title}`, '章节'); item.chapterId=a.id; fields(item,['acts',i],[['title','章节名称','text',120],['summary','章节概述','text',600]]); read(item,'包含场景',named(a.sceneIds)); });
    s.scenes.forEach((c,i) => {
        const item=section(`${c.id === s.startSceneId ? '开场 · ' : ''}${c.title}`, '场景', c.id === s.startSceneId), base=['scenes',i];
        fields(item,base,[['title','场景名称','text',120],['location','地点','text',160],['timeLabel','时间','text',120],['description','场景画面','text',800],['objective','当前目标','text',500],['anchors','世界书扫描词','lines',100]]);
        read(item,'进入场景时成立的事实',named(c.entryFacts));
        c.moves.forEach((m,j)=>{
            const prefix=[...base,'moves',j], label=`行动 ${j+1} · ${m.label}`;
            fields(item,prefix,[['label',`${label}｜名称`,'text',120],['description',`${label}｜玩家在做什么`,'text',400],['mustHappen',`${label}｜必须发生的后果（每行一项）`,'lines',600],['clockAdvance',`${label}｜时间推进（分钟）`,'number',240]]);
            field(item,[...prefix,'publicPatch','objective'],`${label}｜新的目标（可留空）`,'nullable',500);
            read(item,`${label}｜去向`,m.nextSceneId?named([m.nextSceneId]):m.endingId?`结局：${named([m.endingId])}`:m.checkId?'等待判定后进入对应后果':'留在当前场景');
            read(item,`${label}｜判定`,m.checkId?named([m.checkId]):'无需投骰');
            read(item,`${label}｜条件`,[m.conditions.allFacts.length?`全部已发生：${named(m.conditions.allFacts)}`:'',m.conditions.anyFacts.length?`至少发生一个：${named(m.conditions.anyFacts)}`:'',m.conditions.notFacts.length?`尚未发生：${named(m.conditions.notFacts)}`:''].filter(Boolean).join('\n')||'随时可选');
            read(item,`${label}｜公开变化`,named([...m.publicPatch.knownPeopleIds,...m.publicPatch.knownClueIds,...m.publicPatch.itemIds,...m.publicPatch.crisisIds]));
            read(item,`${label}｜揭露秘密`,named(m.revealSecretIds));
            read(item,`${label}｜登记事实`,named(m.hiddenPatch.occurredFactIds)); read(item,`${label}｜幕后变量`,variables(m.hiddenPatch.setVariables));
        });
    });
    s.npcs.forEach((n,i)=>{const item=section(n.name,'人物');fields(item,['npcs',i],[['name','姓名','text',80],['role','身份','text',120],['publicRelation','公开关系','text',200],['publicDescription','公开描述','text',500],['hiddenGoal','隐藏目的','text',600]]);n.agenda.forEach((a,j)=>{field(item,['npcs',i,'agenda',j,'action'],`幕后行动 ${j+1}`,'text',500);read(item,'行动发生时机',s.clocks[0].thresholds.find(t=>t.id===a.thresholdId)?.publicWarning);read(item,'对应事实',named([a.factId]));});});
    const facts=section('既定事实','真相');s.coreFacts.forEach((f,i)=>field(facts,['coreFacts',i,'text'],`事实 ${i+1}`,'text',600));
    s.secrets.forEach((v,i)=>{const item=section(v.title,'真相');fields(item,['secrets',i],[['title','秘密名称','text',120],['fact','隐藏真相','text',800],['revealText','揭露时的内容','text',600],['leakPhrases','揭露前禁止出现的短语（每行一项）','lines',120]]);});
    s.clocks.forEach((c,i)=>{const item=section(c.label,'时间');fields(item,['clocks',i],[['label','时间线名称','text',120],['startMinute','起始分钟','number',10000],['endMinute','结束分钟','number',10000]]);c.thresholds.forEach((t,j)=>{fields(item,['clocks',i,'thresholds',j],[['minute',`事件 ${j+1}｜发生分钟`,'number',10000],['publicWarning',`事件 ${j+1}｜可察觉变化`,'text',400],['hiddenEvent',`事件 ${j+1}｜幕后事件`,'text',600]]);read(item,'登记事实',named([t.factId]));read(item,'变量变化',variables(t.setVariables));});});
    const catalogLabels={people:'人物记录',clues:'线索',items:'物品',crises:'危机'};
    Object.entries(s.knowledge).forEach(([kind,entries])=>entries.forEach((entry,i)=>{const item=section(`${catalogLabels[kind]} · ${entry.name}`,'知识');fields(item,['knowledge',kind,i],[['name','名称','text',100],['detail','详情','text',600],['anchors','相关扫描词','lines',100]]);for(const [k,label,max] of [['relation','关系',240],['status','状态',240],['urgency','紧迫性',120]])if(k in entry)field(item,['knowledge',kind,i,k],label,'text',max);}));
    s.checks.forEach((c,i)=>{const item=section(c.reason,'判定');fields(item,['checks',i],[['reason','判定原因','text',360],['difficulty','难度','number',40],['successStakes','成功意味着','text',500],['failureStakes','失败意味着','text',500]]);read(item,'属性与骰子',`${{body:'身手',insight:'洞察',rapport:'交涉'}[c.attribute]} · ${c.formula}`);read(item,'成功后执行',named([c.successMoveId]));read(item,'失败后执行',named([c.failureMoveId]));});
    s.endings.forEach((e,i)=>{const item=section(e.title,'结局');fields(item,['endings',i],[['title','结局名称','text',160],['summary','结局内容','text',900],['epilogue','尾声','text',900]]);});
    return sections;
}

export function editScenarioContent(original, changes) {
    const fields = new Map(scenarioContentSections(original).flatMap(s => s.fields).filter(f => f.type !== 'read').map(f => [f.key,f]));
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('剧本修改内容无效。');
    const draft=structuredClone(original); delete draft.hash;
    let changed=false;
    for(const [key,raw] of Object.entries(changes)) {
        const field=fields.get(key); if(!field || typeof raw !== 'string') throw new Error('修改包含不支持的字段。');
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(raw)) throw new Error(`${field.label}包含无法使用的控制字符。`);
        let value;
        if(field.type==='number'){if(!/^\d+$/.test(raw.trim()))throw new Error(`${field.label}必须填写整数。`);value=Number(raw);}
        else if(field.type==='lines')value=raw.split(/\r?\n/u).map(v=>v.trim()).filter(Boolean);
        else {value=raw.trim().replace(/[\r\n\t]+/gu,' ');if(field.type==='nullable'&&!value)value=null;}
        if(JSON.stringify(value)!==JSON.stringify(field.value))changed=true;
        let parent=draft; for(const part of field.path.slice(0,-1))parent=parent[part]; parent[field.path.at(-1)]=value;
    }
    if(!changed)throw new Error('还没有修改剧本内容。');
    draft.contentVersion=nextScenarioVersion(original.contentVersion);
    try { assertContract(draft,SCENARIO_DRAFT_CONTRACT,'修改后的剧本'); }
    catch(error) {
        for(const field of fields.values()) { const path='$'+field.path.map(p=>typeof p==='number'?`[${p}]`:`.${p}`).join(''); error.message=error.message.replaceAll(path,field.label); }
        throw error;
    }
    const result=finalizeScenario(draft);
    const graph = analyzeScenarioGraph(result);
    if (!graph.isComplete) {
        if (draft.startSceneId !== original.startSceneId) {
            const missed = [...graph.unreachableSceneIds, ...graph.unreachableEndingIds].map(id => [...result.scenes, ...result.endings].find(item => item.id === id)?.title ?? id);
            throw new Error(`不能从这个场景开场：${missed.length ? `后续无法抵达“${missed.slice(0, 5).join('”、“')}”${missed.length > 5 ? '等内容' : ''}` : '所选路线没有后续行动'}。请先通过整本改写调整场景连接，再更换开场。输入的修改仍保留。`);
        }
        throw new Error('修改后的剧本存在无法抵达的场景或结局，没有保存。');
    }
    return result;
}
