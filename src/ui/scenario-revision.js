import { renderCheckControl } from './check-control.js';
const esc = v => String(v ?? '').replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const sectionKey = section => section.fields.find(f => f.key)?.key;
export function renderRevisionSelection(doc, selection = {mode:'selected',ids:[]}) {
    const items = doc.sections.filter(s => sectionKey(s));
    return `<label><span>改写范围</span><select name="rewriteMode" aria-label="改写范围"><option value="selected" ${selection.mode !== 'all' ? 'selected' : ''}>只改选中的部分</option><option value="all" ${selection.mode === 'all' ? 'selected' : ''}>整本改写</option></select></label>
    ${selection.mode !== 'all' ? `<details class="cw-rewrite-selection"><summary>选择改写部分（已选 ${selection.ids.length} 处）</summary><div>${items.map(s => renderCheckControl({name:'rewriteSections',value:sectionKey(s),label:s.title,description:s.group,checked:selection.ids.includes(sectionKey(s)),selection:true})).join('')}</div></details><p class="cw-form-note">只重新生成所选部分，其余内容原样保留。局部改写保留现有场景和分支；需要增删场景或重排分支时，请选择整本改写。</p>` : '<p class="cw-form-note">整本改写会重新编排完整规划和全部场景。</p>'}`;
}
