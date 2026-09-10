const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(label,action,extra='')=>`<button type="button" class="cw-button" data-action="chapter-${action}" ${extra}>${label}</button>`;
export const emptyChapterScene=()=>({title:'',description:'',location:'',timeLabel:'',objective:'',action:'继续前行',consequence:'',minutes:0});
export function readChapterForm(panel,draft) {
 const form=panel.querySelector('[data-chapter-form]');if(!form)return draft;
 const data=new FormData(form), next=structuredClone(draft);
 for(const key of ['request','mode','returnSceneId'])next[key]=String(data.get(key)??'').trim();
 next.chapter={title:String(data.get('title')??'').trim(),summary:String(data.get('summary')??'').trim(),connection:String(data.get('connection')??'').trim(),scenes:(draft.chapter?.scenes??[]).map((s,i)=>Object.fromEntries(Object.keys(s).map(k=>[k,k==='minutes'?Number(data.get(`scene-${i}-${k}`)):String(data.get(`scene-${i}-${k}`)??'').trim()])))};
 return next;
}
export function renderChapterEditor(d,busyAction) {
 if(!d)return '<section class="cw-page"><p>请从正在进行的故事打开新增章节。</p></section>';
 const field=(name,label,value,max,rows=2)=>`<label class="cw-script-field"><span>${label}</span><textarea name="${name}" maxlength="${max}" rows="${rows}">${esc(value)}</textarea></label>`;
 const c=d.chapter??{title:'',summary:'',connection:'',scenes:[]};
 return `<section class="cw-page cw-chapter-editor"><h2>中途加入章节</h2>${busyAction==='chapter-write'?button('停止生成','cancel'):''}<p>草稿可反复修改。确认接入后才改变当前旅程。</p><p>${esc(d.notice??'')}</p><form data-chapter-form>${field('request','章节想法或重新生成的修改意见',d.request,4000,3)}${button('生成 / 按意见重新生成','write')}${button('保存草稿','save')}${field('title','章节名称',c.title,120)}${field('summary','章节概述',c.summary,600,3)}${field('connection','如何衔接当前故事',c.connection,400,3)}
 ${c.scenes.map((s,i)=>`<article class="cw-player-card"><h3>场景 ${i+1}</h3>${[['title','场景名称',120],['description','场景内容',800],['location','地点',160],['timeLabel','时间描述',120],['objective','当前目标',500],['action','前进行动',120],['consequence','行动后果与衔接',600]].map(([k,label,max])=>field(`scene-${i}-${k}`,label,s[k],max)).join('')}<label class="cw-script-field"><span>行动耗时（分钟）</span><input type="number" name="scene-${i}-minutes" min="0" max="240" value="${s.minutes}"></label>${button('上移','up',`data-index="${i}"`)}${button('下移','down',`data-index="${i}"`)}${button('删除场景','remove',`data-index="${i}"`)}</article>`).join('')}${c.scenes.length<8?button('添加场景','add'):''}
 <label class="cw-script-field"><span>接入时机</span><select name="mode"><option value="now" ${d.mode==='now'?'selected':''}>立即接入</option><option value="after" ${d.mode==='after'?'selected':''}>当前章节结束后接入</option></select></label>
 <label class="cw-script-field"><span>立即接入：新增章节结束后返回</span><select name="returnSceneId">${d.sceneOptions.map(s=>`<option value="${esc(s.id)}" ${d.returnSceneId===s.id?'selected':''}>${esc(s.title)}</option>`).join('')}</select></label><p>章节结束后接入时，会按原来的出口接回对应场景或结局。立即接入会更新当前场景，下一次聊天从新场景继续。</p>
 ${button('确认接入当前旅程','accept')}${button('更新接入位置至当前进度','rebase')}${button('保存草稿并返回','back')}</form></section>`;
}
