const isSkillLearned = e => e.kind === 'skill' && (e.learned ?? e.value >= e.learnAt);
export const PLAYER_FORM_LIMITS = Object.freeze({ entries: 12, rules: 4, thresholds: 4 });
const esc = value => String(value ?? '').replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const playerId = () => `p_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;
export function newPlayerEntry(kind = 'resource') {
    return { id:playerId(),kind,name:'',value:kind==='skill'?10:100,min:0,max:100,learnAt:kind==='skill'?100:null,learned:kind==='skill'?true:null,enabled:true,effect:'',condition:'',rules:[],thresholds:[] };
}
export function editablePlayerEntries(entries) {
    return entries.map(e=>({...e,enabled:e.enabled!==false,effect:e.effect??'',condition:e.condition??'',learned:e.kind==='skill'?isSkillLearned(e):null,...(e.kind==='skill'?{min:0,max:100,learnAt:100,value:Math.min(100,Math.max(0,e.value))}:{})}));
}
const button = (label, action, attrs = '') => `<button type="button" class="cw-text-button" data-action="${action}" ${attrs}>${label}</button>`;
const field = (label, name, value, attrs = '') => `<label><span>${label}</span><input name="${esc(name)}" value="${esc(value)}" ${attrs}></label>`;
const options = (items, selected) => items.map(([value, label]) => `<option value="${value}" ${String(value)===String(selected)?'selected':''}>${label}</option>`).join('');
const select = (label, name, items, selected) => `<label><span>${label}</span><select name="${esc(name)}">${options(items, selected)}</select></label>`;
const hidden = (name,value) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;
const numberField = (label,name,value,min=-1000000,max=1000000) => `<label><span>${label}</span><input aria-label="${esc(label)}" name="${esc(name)}" value="${esc(value)}" type="number" step="1" min="${min}" max="${max}" required></label>`;
function entryEditor(e,initial) {
    return `${hidden('playerEntryId',e.id)}${hidden(`${e.id}.kind`,e.kind)}${hidden(`${e.id}.enabled`,e.enabled!==false)}
        ${field(e.kind==='skill'?'技能名称':'数值名称',`${e.id}.name`,e.name,'maxlength="40" required')}
        ${e.kind==='skill'?`${select('学习状态',`${e.id}.learned`,[['true','已学会，可以尝试使用'],['false','尚未学会']],e.learned??isSkillLearned(e))}${field('使用条件',`${e.id}.condition`,e.condition??'','maxlength="200" required placeholder="例如：能够看见目标，且有足够魔力"')}${field('触发效果',`${e.id}.effect`,e.effect??'','maxlength="240" required placeholder="例如：释放一枚火球"')}`:`${field('用途与表现',`${e.id}.effect`,e.effect??'','maxlength="240"')}${hidden(`${e.id}.condition`,e.condition??'')}`}
        <div class="cw-player-number-grid">${numberField(e.kind==='skill'?'熟练度':initial?'初始值':'当前值',`${e.id}.value`,e.value,e.kind==='skill'?0:-1000000,e.kind==='skill'?100:1000000)}${e.kind==='skill'?`${hidden(`${e.id}.min`,0)}${hidden(`${e.id}.max`,100)}${hidden(`${e.id}.learnAt`,100)}<p class="cw-form-note">范围 0～100。点数不超过熟练度才触发；100 时直接触发。</p>`:`${numberField('最低值',`${e.id}.min`,e.min)}${numberField('最高值',`${e.id}.max`,e.max)}`}</div>
        <h4>什么时候增减</h4><p class="cw-form-note">规则只在本次行动符合条件时生效。触发成功包含熟练度 100 的直接触发。</p>
        ${e.rules.map(r=>`<div class="cw-player-rule">${hidden(`${e.id}.ruleId`,r.id)}${field('触发条件',`${r.id}.condition`,r.condition,'maxlength="200" required')}<div class="cw-player-pair">${numberField('变化量',`${r.id}.delta`,r.delta)}${select('生效时机',`${r.id}.timing`,[['action','尝试或练习时'],['success','触发／判定成功后'],['failure','触发／判定失败后']],r.timing)}</div>${button('移除规则','player-remove-rule',`data-entry-id="${e.id}" data-item-id="${r.id}"`)}</div>`).join('')}
        ${e.rules.length<4?button('添加增减规则','player-add-rule',`data-entry-id="${e.id}"`):''}
        <h4>达到数值时的反应</h4>
        ${e.thresholds.map(t=>`<div class="cw-player-rule">${hidden(`${e.id}.thresholdId`,t.id)}<div class="cw-player-pair">${select('触发条件',`${t.id}.operator`,[['gte','达到或高于'],['lte','低于或等于']],t.operator)}${numberField('门槛数值',`${t.id}.value`,t.value,e.min,e.max)}</div>${field('发生什么反应',`${t.id}.reaction`,t.reaction,'maxlength="240" required')}${select('触发方式',`${t.id}.mode`,[['while','处于范围时持续表现'],['cross','每次进入范围时触发'],['once','这段旅程只触发一次']],t.mode)}${button('移除反应','player-remove-threshold',`data-entry-id="${e.id}" data-item-id="${t.id}"`)}</div>`).join('')}
        ${e.thresholds.length<4?button('添加数值反应','player-add-threshold',`data-entry-id="${e.id}"`):''}`;
}
const reviewMessage = issues => issues.length ? `有 ${issues.length} 项待修改。草稿可以保存，修改后再绑定故事。` : '';
export function updatePlayerReview(panel, issues) {
    if (!panel) return;
    const status = panel.querySelector('[data-player-review-status]');
    if (status) { status.textContent = reviewMessage(issues); status.hidden = !issues.length; }
    for (const card of panel.querySelectorAll('[data-player-entry]')) {
        const issue = issues.find(v => v.entryId === card.dataset.playerEntry);
        const notice = card.querySelector('[data-player-entry-issue]');
        if (notice) { notice.hidden = !issue; notice.querySelector('span').textContent = issue?.message ?? ''; }
        card.classList.toggle('has-review-issue', Boolean(issue));
        for (const input of card.querySelectorAll('input,select')) {
            if (issue?.field === input.name) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', notice.id); }
            else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
        }
    }
    const bind = panel.querySelector('[data-action="submit-create"][data-review-binding]');
    if (bind) bind.disabled = bind.dataset.reviewBinding !== 'true' || Boolean(issues.length);
}
export function renderPlayerEntries(entries=[],initial=false,issues=[]) {
    return `<section class="cw-player-entries"><h3>我的数值与技能</h3><p class="cw-form-note">点开一项修改；向左滑动查看操作。技能熟练度 100 时稳定触发。</p><p class="cw-player-review" data-player-review-status role="status" ${issues.length?'':'hidden'}>${esc(reviewMessage(issues))}</p><div class="cw-player-tools">${button('添加数值','player-add-entry','data-kind="resource"')}${button('添加技能','player-add-entry','data-kind="skill"')}${button('撤销删除','player-undo-remove','data-player-undo hidden')}</div>
    ${entries.length?'':'<p class="cw-empty-state">还没有条目。可以根据剧本生成，也可以自己添加。</p>'}
    ${entries.map(e=>{const issue=issues.find(v=>v.entryId===e.id);return `<article class="cw-player-entry${e.enabled===false?' is-disabled':''}" data-player-entry="${esc(e.id)}"><div class="cw-entry-swipe"><div class="cw-entry-face"><button type="button" class="cw-entry-summary" data-action="player-open-entry" data-entry-id="${e.id}"><span><strong>${esc(e.name||'新'+(e.kind==='skill'?'技能':'数值'))}</strong><small>${esc(e.enabled===false?'已停用':e.kind==='skill'?(e.learned??isSkillLearned(e))?'已学会':'尚未学会':'数值')} · ${esc(e.rules[0]?.condition||e.effect||'点开填写规则')}</small></span><b>${esc(e.value)}<small> / ${esc(e.max)}</small></b></button>${button('操作','player-entry-menu',`data-entry-id="${e.id}" aria-label="${esc(e.name||'条目')}的操作"`)}</div><div class="cw-entry-actions">${button('编辑','player-open-entry',`data-entry-id="${e.id}"`)}${button(e.enabled===false?'启用':'停用','player-toggle-entry',`data-entry-id="${e.id}"`)}${button('删除','player-remove-entry',`data-entry-id="${e.id}"`)}</div></div><div class="cw-player-review" data-player-entry-issue id="cw-player-issue-${esc(e.id)}" ${issue?'':'hidden'}><span>${esc(issue?.message??'')}</span>${button('修改这一项','player-open-entry',`data-entry-id="${e.id}" data-focus-issue="true"`)}</div><details class="cw-entry-details" ${e.name?'':'open'}><summary>完整规则</summary><div class="cw-entry-editor">${entryEditor(e,initial)}</div></details></article>`;}).join('')}</section>`;
}
// Keep incomplete input in the draft so a validation error never discards edits.
export function playerEntriesFromForm(form) {
    const get=key=>String(form.get(key)??'');
    return form.getAll('playerEntryId').map(id=>({id,kind:get(`${id}.kind`),name:get(`${id}.name`),value:get(`${id}.value`),min:get(`${id}.min`),max:get(`${id}.max`),learnAt:get(`${id}.kind`)==='skill'?get(`${id}.learnAt`):null,
        enabled:get(`${id}.enabled`)!=='false',learned:get(`${id}.kind`)==='skill'?get(`${id}.learned`)==='true':null,effect:get(`${id}.effect`),condition:get(`${id}.condition`),
        rules:form.getAll(`${id}.ruleId`).map(id=>({id,condition:get(`${id}.condition`),delta:get(`${id}.delta`),timing:get(`${id}.timing`)})),thresholds:form.getAll(`${id}.thresholdId`).map(id=>({id,operator:get(`${id}.operator`),value:get(`${id}.value`),reaction:get(`${id}.reaction`),mode:get(`${id}.mode`)}))}));
}
export function numericPlayerEntries(entries) {
    const num=v=>String(v).trim()===''?NaN:Number(v);
    return entries.map(e=>({...e,name:e.name.trim(),value:num(e.value),min:num(e.min),max:num(e.max),learnAt:e.kind==='skill'?num(e.learnAt):null,rules:e.rules.map(r=>({...r,condition:r.condition.trim(),delta:num(r.delta)})),thresholds:e.thresholds.map(t=>({...t,reaction:t.reaction.trim(),value:num(t.value)}))}));
}
export function renderPlayerState(view) {
    const p=view.player.progression;
    return `<section class="cw-page cw-player-state"><div class="cw-page-heading"><p class="cw-eyebrow">${esc(view.player.name)}</p><h2>角色状态</h2><p>随剧情记录消耗、成长与变化。</p></div>${(p?.entries??[]).map(e=>`<article class="cw-player-card"><div><h3>${esc(e.name)}</h3><strong>${e.value}<small> / ${e.max}</small></strong></div><progress aria-label="${esc(e.name)}" max="${e.max-e.min}" value="${e.value-e.min}"></progress><p>${e.enabled===false?'已停用':e.kind==='skill'?isSkillLearned(e)?e.value>=100?'已熟练 · 符合条件时直接触发':`已学会 · 触发概率 ${e.value}%`:'尚未学会':`范围 ${e.min}～${e.max}`}</p>${e.effect?`<p>${esc(e.effect)}</p>`:''}${e.enabled!==false?e.thresholds.filter(t=>t.mode==='while'&&(t.operator==='gte'?e.value>=t.value:e.value<=t.value)).map(t=>`<p>${esc(t.reaction)}</p>`).join(''):''}</article>`).join('')||'<p>还没有配置数值或技能。</p>'}
    ${view.player.nameHistory?.length?`<details class="cw-player-log"><summary>称呼变化</summary><ul>${[...view.player.nameHistory].reverse().map(i=>`<li>${esc(i.previousName)} → ${esc(i.name)}${i.source==='manual'?'（手动修改）':'（随剧情变化）'}</li>`).join('')}</ul></details>`:''}
    ${view.canEditPlayer?button('编辑规则与手动修正','player-edit'):'<p>当前推进结束后可以编辑。</p>'}${p?.notices.length?'<p class="cw-form-note">手动调整已保存，相关反应在下一轮体现。</p>':''}
    ${p?.log.length?`<details class="cw-player-log"><summary>最近的数值变化</summary>${[...p.log].reverse().map(l=>`<article><small>第 ${l.revision} 次状态记录</small><ul>${l.details.map(d=>`<li>${esc(d)}</li>`).join('')}</ul></article>`).join('')}</details>`:''}${button('返回故事','player-back')}</section>`;
}
export function renderPlayerEditor(entries,name='',issues=[]) {
    return `<section class="cw-page"><h2>编辑角色状态</h2><p class="cw-form-note">修改称呼、技能、规则和数值，保存后生效。</p><form class="cw-form" data-form="player-progression">${field('当前称呼','playerCurrentName',name,'maxlength="120" required autocomplete="off"')}<p class="cw-form-note">剧情明确改名或采用化名时会更新称呼，也可手动修改。旧经历仍属于同一人。</p>${renderPlayerEntries(entries,false,issues)}<button type="submit" class="cw-button cw-button--primary">保存角色状态</button>${button('取消修改','player-cancel-edit')}</form></section>`;
}
