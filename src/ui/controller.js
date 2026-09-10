import { readChapterModules, newChapterModule } from './chapter-modules.js';
import { readChapterForm, emptyChapterScene } from './chapter-editor.js';
import { PLAYER_FORM_LIMITS, editablePlayerEntries, newPlayerEntry, playerId, playerEntriesFromForm, numericPlayerEntries, updatePlayerReview } from './player-progression.js';
import { emptyApiDraft, apiDraftFromForm, apiSelectionFromForm } from './api-settings.js';
import { normalizeViewModel, renderPanel, renderToggle } from './render.js';
import {
    FLOATING_TOGGLE_POSITION_STORAGE_KEY,
    clampFloatingTogglePosition,
    didFloatingToggleMove,
    parseFloatingTogglePosition,
    positionFromFloatingTogglePointer,
    serializeFloatingTogglePosition,
} from './floating-toggle-position.js';

const JSON_FILE_LIMIT = 2 * 1024 * 1024;
const FLOATING_TOGGLE_INSET = 12;
const CUSTOM_SCENARIO_FIELDS = Object.freeze([
    'title', 'premise', 'tone', 'setting', 'opening', 'coreTruth', 'npcGoals', 'timePressure', 'endings',
]);

function messageOf(error) {
    return error instanceof Error ? error.message : String(error ?? '未知错误');
}

function parseJsonFile(file) {
    if (file.size > JSON_FILE_LIMIT) throw new Error('文件超过 2 MB，无法导入。');
    // Keep the original text intact so the strict transfer boundary can reject
    // duplicate JSON keys instead of receiving JSON.parse's silently collapsed
    // object representation.
    return file.text();
}

function safeFilename(value) {
    const name = String(value || 'candy-w-journey').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
    return name || 'candy-w-journey';
}

function loadFloatingTogglePosition() {
    try {
        return parseFloatingTogglePosition(globalThis.localStorage?.getItem(FLOATING_TOGGLE_POSITION_STORAGE_KEY));
    } catch {
        return null;
    }
}

function persistFloatingTogglePosition(position) {
    try {
        globalThis.localStorage?.setItem(FLOATING_TOGGLE_POSITION_STORAGE_KEY, serializeFloatingTogglePosition(position));
    } catch {
        // A purely cosmetic preference must never prevent the story UI from opening.
    }
}

export function campaignInputFromFormData(formData, fallbackScenarioId = '') {
    const attributes = {
        body: Number(formData.get('attributeBody')),
        insight: Number(formData.get('attributeInsight')),
        rapport: Number(formData.get('attributeRapport')),
    };
    const allocation = Object.values(attributes).slice().sort((left, right) => left - right);
    if (!['0,0,0','0,1,2'].includes(allocation.join(','))) throw new Error('身手、洞察、交涉必须把 +2、+1、+0 各分配一次。');
    return {
        scenarioId: String(formData.get('scenarioId') ?? fallbackScenarioId),
        ...(formData.getAll('playerEntryId').length ? { playerEntries: numericPlayerEntries(playerEntriesFromForm(formData)) } : {}),
        player: {
            name: String(formData.get('playerName') ?? '').trim(),
            concept: String(formData.get('playerConcept') ?? '').trim(),
            relationship: String(formData.get('playerRelationship') ?? '').trim(),
            attributes,
        },
    };
}

export function customScenarioInputFromFormData(formData) {
    return { ...Object.fromEntries([...CUSTOM_SCENARIO_FIELDS, 'anchors'].map(field => [field, String(formData.get(field) ?? '').trim()])), useWorldInfo: formData.get('useWorldInfo') === 'on', ...(formData.getAll('chapterId').length?{chapterOutline:formData.getAll('chapterId').map((id,i)=>({id:String(id),title:String(formData.getAll('chapterTitle')[i]??'').trim(),summary:String(formData.getAll('chapterSummary')[i]??'').trim()}))}:{}) };
}

export class DirectorUi {
    constructor(application) {
        if (!application || typeof application.getViewModel !== 'function' || typeof application.subscribe !== 'function') throw new Error('DirectorUi 需要完整的 application 接口。');
        this.app = application;
        this.open = false;
        this.screen = 'welcome';
        this.activeTab = 'now';
        this.scenarios = [];
        this.selectedScenarioId = '';
        this.scenarioDocument = null; this.scriptEditing = false; this.scriptGroup = '全部'; this.scriptDrafts = {}; this.revisionRequests = {}; this.revisionSelections = {};
        this.authoringDraft = { ...Object.fromEntries([...CUSTOM_SCENARIO_FIELDS, 'anchors'].map(field => [field, ''])), useWorldInfo: false };
        this.playerDraft = {};
        this.scenarioSetup = null; this.setupNotice = '';
        this.playerEditName = '';
        this.playerEntries = [];
        this.playerEditRevision = null;
        this.playerEditKey = null;
        this.apiDraft = emptyApiDraft();
        this.apiSelection = {};
        this.apiModels = [];
        this.apiNotice = '';
        this.localError = '';
        this.busyAction = '';
        this.toggle = null;
        this.panel = null;
        this.previousFocus = null;
        this.floatingTogglePosition = null;
        this.floatingToggleDrag = null;
        this.suppressToggleClick = false;
        this.clearToggleClickSuppression = null;
        this.unsubscribe = this.app.subscribe(() => {
            this.reconcileScreen();
            this.render();
        });
        this.onKeydown = event => {
            if (event.key === 'Escape' && this.open) this.close();
        };
        this.onToggleClick = event => this.handleToggleClick(event);
        this.onTogglePointerDown = event => this.handleTogglePointerDown(event);
        this.onTogglePointerMove = event => this.handleTogglePointerMove(event);
        this.onTogglePointerUp = event => this.handleTogglePointerUp(event);
        this.onTogglePointerCancel = event => this.handleTogglePointerCancel(event);
        this.onViewportChange = () => this.restoreFloatingTogglePosition();
        this.onPanelInput = event => { if(event.target.name==='chapterTitle'){const label=event.target.closest('[data-outline-id]')?.querySelector('.cw-outline-name');if(label)label.textContent=event.target.value.trim()||'未命名';} if(event.target.matches('.cw-script-document textarea')){event.target.style.height='auto';event.target.style.height=event.target.scrollHeight+'px';} if(event.target.closest('[data-chapter-form]'))this.chapterDraft=readChapterForm(this.panel,this.chapterDraft);else this.captureAuthoringDraft(event); };
    }

    mount() {
        if (this.toggle || this.panel) return this;
        this.toggle = document.createElement('button');
        this.toggle.id = 'cw-director-toggle';
        this.toggle.type = 'button';
        this.toggle.className = 'menu_button';
        this.toggle.setAttribute('aria-label', '打开 Candy W 世界入口；可拖动移动入口位置');
        this.toggle.setAttribute('aria-controls', 'cw-director-panel');
        this.toggle.title = '拖动可移动；点击打开世界入口';
        this.toggle.addEventListener('click', this.onToggleClick);
        this.toggle.addEventListener('pointerdown', this.onTogglePointerDown);
        this.toggle.addEventListener('pointermove', this.onTogglePointerMove);
        this.toggle.addEventListener('pointerup', this.onTogglePointerUp);
        this.toggle.addEventListener('pointercancel', this.onTogglePointerCancel);
        document.body.append(this.toggle);

        this.panel = document.createElement('aside');
        this.panel.id = 'cw-director-panel';
        this.panel.setAttribute('role', 'dialog');
        this.panel.setAttribute('aria-label', 'Candy W 故事世界');
        this.panel.setAttribute('aria-modal', 'false');
        this.panel.setAttribute('aria-hidden', 'true');
        this.panel.addEventListener('click', event => void this.handleClick(event));
        this.panel.addEventListener('submit', event => void this.handleSubmit(event));
        this.panel.addEventListener('change', event => void this.handleFileChange(event));
        this.panel.addEventListener('input', this.onPanelInput);
        this.panel.addEventListener('dragstart',event=>{const module=event.target.closest('[data-outline-index]');if(module){this.outlineDrag=Number(module.dataset.outlineIndex);event.dataTransfer.effectAllowed='move';}});
        this.panel.addEventListener('dragover',event=>{if(event.target.closest('[data-outline-index]'))event.preventDefault();});
        this.panel.addEventListener('drop',event=>{const module=event.target.closest('[data-outline-index]');if(module&&Number.isInteger(this.outlineDrag)){event.preventDefault();void this.perform('outline-drop',{index:module.dataset.outlineIndex,from:this.outlineDrag});this.outlineDrag=null;}});

        this.panel.addEventListener('invalid',event=>{const details=event.target.closest('.cw-entry-details');if(details)details.open=true;},true);
        document.body.append(this.panel);
        document.addEventListener('keydown', this.onKeydown);
        window.addEventListener('resize', this.onViewportChange, { passive: true });
        window.addEventListener('orientationchange', this.onViewportChange);
        this.floatingTogglePosition = loadFloatingTogglePosition();
        this.refreshScenarios();
        this.render();
        this.restoreFloatingTogglePosition();
        return this;
    }

    destroy() {
        this.unsubscribe?.();
        document.removeEventListener('keydown', this.onKeydown);
        window.removeEventListener('resize', this.onViewportChange);
        window.removeEventListener('orientationchange', this.onViewportChange);
        if (this.clearToggleClickSuppression !== null) clearTimeout(this.clearToggleClickSuppression);
        this.toggle?.remove();
        this.panel?.remove();
        this.toggle = null;
        this.panel = null;
    }

    getViewModel() {
        return this.app.getViewModel() ?? { phase: 'empty', enabled: true, host: { kind: 'none' } };
    }

    reconcileScreen() {
        const view = normalizeViewModel(this.getViewModel());
        if (this.screen === 'player-editor' && this.playerEditKey !== this.getViewModel().campaignKey) { this.screen = 'welcome'; this.playerEntries = []; this.playerEditKey = null; }
        if (view.phase === 'empty' && ['player-state', 'player-editor'].includes(this.screen)) this.screen = 'welcome';
        if (view.phase !== 'empty' && !['chapter-editor', 'api-settings', 'player-state', 'player-editor', 'scenarios', 'script', 'authoring', 'player'].includes(this.screen)) this.screen = 'welcome';
        if(this.screen==='chapter-editor'&&this.chapterDraft?.owner!==this.app.getScenarioContextKey?.()){this.screen='welcome';this.chapterDraft=null;}
        if (this.scenarioDocument?.campaignKey && this.scenarioDocument.campaignKey !== this.app.getScenarioContextKey?.()) { this.scenarioDocument = null; this.scriptEditing = false; if(this.screen === 'script') this.screen = 'scenarios'; }
        if (view.phase === 'playing' && !['now', 'known', 'chapter'].includes(this.activeTab)) this.activeTab = 'now';
    }

    async refreshScenarios() {
        try {
            const scenarios = await Promise.resolve(this.app.listScenarios());
            this.scenarios = Array.isArray(scenarios) ? scenarios : [];
            if (!this.selectedScenarioId && this.scenarios.length) this.selectedScenarioId = String(this.scenarios[0].id ?? this.scenarios[0].scenarioId ?? '');
            this.render();
        } catch (error) {
            this.localError = messageOf(error);
            this.render();
        }
    }

    show() {
        this.previousFocus = document.activeElement;
        this.open = true;
        this.refreshScenarios();
        this.render();
        queueMicrotask(() => this.panel?.querySelector('#cw-director-main')?.focus());
    }

    close() {
        this.open = false;
        this.render();
        if (this.previousFocus instanceof HTMLElement) this.previousFocus.focus();
    }

    render() {
        if (!this.toggle || !this.panel) return;
        const viewModel = this.getViewModel();
        const view = normalizeViewModel(viewModel);
        const active = !['empty', 'ended'].includes(view.phase);
        this.toggle.innerHTML = renderToggle(viewModel);
        this.toggle.setAttribute('aria-expanded', String(this.open));
        this.toggle.setAttribute('aria-label', active
            ? '打开 Candy W 故事；旅程进行中；可拖动移动入口位置'
            : '打开 Candy W 世界入口；可拖动移动入口位置');
        this.toggle.title = active
            ? '旅程进行中；拖动可移动；点击查看故事'
            : '拖动可移动；点击进入世界';
        this.restoreFloatingTogglePosition();
        this.panel.classList.toggle('is-open', this.open);
        this.panel.setAttribute('aria-hidden', String(!this.open));
        if (!this.open) return;
        const sameScript = this.panel.querySelector('[data-script-key]')?.dataset.scriptKey === this.scenarioDocument?.source + this.scenarioDocument?.hash;
        const revisionOpen=sameScript&&Boolean(this.panel.querySelector('details.cw-script-revision')?.open);
        const scriptOpen = sameScript ? [...this.panel.querySelectorAll('[data-script-section][open]')].map(e => e.dataset.scriptSection) : [];
        const outlineOpen=[...this.panel.querySelectorAll('[data-outline-id][open]')].map(e=>e.dataset.outlineId);
        const playerOpen=[...this.panel.querySelectorAll('[data-player-entry] details[open]')].map(e=>e.closest('[data-player-entry]').dataset.playerEntry);
        const storyDetailsOpen = this.panel.querySelector('.cw-story-details')?.open ?? false;
        const playerScroll = ['player', 'player-editor', 'authoring', 'script', 'chapter-editor'].includes(this.screen) ? this.panel.querySelector('.cw-panel-main')?.scrollTop ?? 0 : null;
        const apiScroll = this.panel.querySelector('.cw-api-settings') ? this.panel.querySelector('.cw-panel-main')?.scrollTop ?? 0 : 0;
        this.panel.innerHTML = renderPanel({
            chapterModules:this.chapterModules,
            deletedScenarios:this.app.getDeletedScenarios?.()??[],
            viewModel,
            chapterDraft: this.chapterDraft,
            screen: this.screen,
            scenarios: this.scenarios,
            selectedScenarioId: this.selectedScenarioId,
            activeTab: this.activeTab,
            playerDraft: this.playerDraft,
            playerEditName: this.playerEditName,
            playerEntries: this.playerEntries, playerIssues: this.reviewPlayerEntries(),
            scenarioSetup: this.scenarioSetup, setupNotice: this.setupNotice,
            localError: this.localError,
            busyAction: this.busyAction,
            scriptSectionTitle:this.scriptSectionTitle,
            scriptInlineKey: this.scriptInlineKey,
            scenarioDocument: this.scenarioDocument, scriptEditing: this.scriptEditing, scriptChanges: this.scriptDrafts[this.scenarioDocument?.hash] ?? {}, scriptGroup: this.scriptGroup, revisionRequest: this.revisionRequests[this.scenarioDocument?.hash] ?? '', revisionSelection: this.revisionSelections[this.scenarioDocument?.hash] ?? {mode:'selected',ids:[]},
            authoringDraft: this.authoringDraft,
            authoringJob: this.app.getAuthoringJob?.(),
            apiSettings: { config: this.app.getApiConfiguration?.() ?? {}, draft: this.apiDraft, selection: this.apiSelection, models: this.apiModels, notice: this.apiNotice },
        });
        updatePlayerReview(this.panel, this.reviewPlayerEntries());
        if (this.screen === 'api-settings') this.panel.querySelector('.cw-panel-main').scrollTop = apiScroll;
        if(revisionOpen)this.panel.querySelector('details.cw-script-revision')?.setAttribute('open','');
        if(this.screen === 'script') this.panel.querySelectorAll('[data-script-section]').forEach(e => { if(scriptOpen.includes(e.dataset.scriptSection)) e.open = true; });
        if (playerScroll !== null) this.panel.querySelector('.cw-panel-main').scrollTop = this.screen === 'script' && !sameScript ? 0 : playerScroll;
        if (storyDetailsOpen && this.screen === 'authoring') this.panel.querySelector('.cw-story-details').open = true;
        for(const id of outlineOpen)this.panel.querySelector(`[data-outline-id="${CSS.escape(id)}"]`)?.setAttribute('open','');
        for (const id of playerOpen) this.panel.querySelector(`[data-player-entry="${id}"] details`)?.setAttribute('open','');
        const undoGeneration=this.panel.querySelector('[data-action="undo-generated-entries"]');if(undoGeneration)undoGeneration.hidden=!this.previousPlayerEntries;
        const undo=this.panel.querySelector('[data-player-undo]');if(undo)undo.hidden=!this.removedPlayerEntry;
        this.panel.querySelectorAll('.cw-script-section[hidden] input,.cw-script-section[hidden] textarea,.cw-script-section[hidden] select').forEach(e=>e.disabled=true);
        this.panel.querySelectorAll('.cw-script-section:not([hidden]) textarea').forEach(e=>{e.style.height='auto';e.style.height=e.scrollHeight+'px';});
        this.panel.setAttribute('aria-busy', String(Boolean(this.busyAction)));
        if (this.busyAction) this.panel.querySelectorAll('main input, main select, main textarea, main button').forEach(control => { control.disabled = control.dataset.action !== 'chapter-cancel'; });
    }

    floatingToggleViewport() {
        return {
            width: Math.max(0, Number(window.innerWidth) || document.documentElement.clientWidth || 0),
            height: Math.max(0, Number(window.innerHeight) || document.documentElement.clientHeight || 0),
        };
    }

    floatingToggleSize() {
        const rect = this.toggle?.getBoundingClientRect();
        return {
            width: Math.max(0, rect?.width || this.toggle?.offsetWidth || 0),
            height: Math.max(0, rect?.height || this.toggle?.offsetHeight || 0),
        };
    }

    restoreFloatingTogglePosition() {
        if (!this.toggle || this.floatingToggleDrag?.moved) return;
        if (!this.floatingTogglePosition) {
            this.toggle.style.removeProperty('left');
            this.toggle.style.removeProperty('top');
            this.toggle.style.removeProperty('right');
            this.toggle.style.removeProperty('bottom');
            return;
        }
        const toggle = this.floatingToggleSize();
        if (!toggle.width || !toggle.height) return;
        this.applyFloatingTogglePosition(clampFloatingTogglePosition(
            this.floatingTogglePosition,
            this.floatingToggleViewport(),
            toggle,
            FLOATING_TOGGLE_INSET,
        ));
    }

    applyFloatingTogglePosition(position) {
        if (!this.toggle) return;
        this.toggle.style.left = `${position.left}px`;
        this.toggle.style.top = `${position.top}px`;
        this.toggle.style.right = 'auto';
        this.toggle.style.bottom = 'auto';
    }

    handleToggleClick(event) {
        if (this.suppressToggleClick) {
            event.preventDefault();
            event.stopPropagation();
            this.suppressToggleClick = false;
            if (this.clearToggleClickSuppression !== null) clearTimeout(this.clearToggleClickSuppression);
            this.clearToggleClickSuppression = null;
            return;
        }
        this.show();
    }

    handleTogglePointerDown(event) {
        if (!this.toggle || event.isPrimary === false || event.pointerType === 'mouse' && event.button !== 0) return;
        const rect = this.toggle.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        this.floatingToggleDrag = {
            pointerId: event.pointerId,
            start: { clientX: event.clientX, clientY: event.clientY },
            grabOffset: { x: event.clientX - rect.left, y: event.clientY - rect.top },
            moved: false,
        };
        this.toggle.setPointerCapture?.(event.pointerId);
    }

    handleTogglePointerMove(event) {
        const drag = this.floatingToggleDrag;
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (!drag.moved && !didFloatingToggleMove(drag.start, event)) return;
        drag.moved = true;
        this.toggle?.classList.add('is-dragging');
        event.preventDefault();
        const toggle = this.floatingToggleSize();
        if (!toggle.width || !toggle.height) return;
        this.applyFloatingTogglePosition(positionFromFloatingTogglePointer(
            event,
            drag.grabOffset,
            this.floatingToggleViewport(),
            toggle,
            FLOATING_TOGGLE_INSET,
        ));
    }

    handleTogglePointerUp(event) {
        const drag = this.floatingToggleDrag;
        if (!drag || event.pointerId !== drag.pointerId) return;
        const moved = drag.moved || didFloatingToggleMove(drag.start, event);
        if (moved) {
            const toggle = this.floatingToggleSize();
            if (toggle.width && toggle.height) {
                this.floatingTogglePosition = positionFromFloatingTogglePointer(
                    event,
                    drag.grabOffset,
                    this.floatingToggleViewport(),
                    toggle,
                    FLOATING_TOGGLE_INSET,
                );
                this.applyFloatingTogglePosition(this.floatingTogglePosition);
                persistFloatingTogglePosition(this.floatingTogglePosition);
            }
            event.preventDefault();
            this.suppressToggleClick = true;
            this.clearToggleClickSuppression = setTimeout(() => {
                this.suppressToggleClick = false;
                this.clearToggleClickSuppression = null;
            }, 0);
        }
        this.releaseFloatingTogglePointer(drag.pointerId);
        this.clearFloatingToggleDrag();
    }

    handleTogglePointerCancel(event) {
        const drag = this.floatingToggleDrag;
        if (!drag || event.pointerId !== drag.pointerId) return;
        this.releaseFloatingTogglePointer(drag.pointerId);
        this.clearFloatingToggleDrag();
        this.restoreFloatingTogglePosition();
    }

    releaseFloatingTogglePointer(pointerId) {
        try {
            if (this.toggle?.hasPointerCapture?.(pointerId)) this.toggle.releasePointerCapture(pointerId);
        } catch {
            // The host may have already released capture while a pointer is cancelled.
        }
    }

    clearFloatingToggleDrag() {
        this.floatingToggleDrag = null;
        this.toggle?.classList.remove('is-dragging');
    }

    reviewPlayerEntries(entries = this.playerEntries) { return this.app.getPlayerEntryIssues(numericPlayerEntries(entries)); }

    capturePlayerDraft(form = this.panel?.querySelector('[data-form="create-campaign"], [data-form="player-progression"]')) {
        if (!form) return;
        const data = new FormData(form);
        this.playerEntries = playerEntriesFromForm(data);
        for (const entry of this.playerEntries) {
            const card=this.panel?.querySelector(`[data-player-entry="${entry.id}"]`);
            const name=card?.querySelector('.cw-entry-summary strong'),value=card?.querySelector('.cw-entry-summary b');
            if(name)name.textContent=entry.name||'新'+(entry.kind==='skill'?'技能':'数值');
            if(value){value.replaceChildren(document.createTextNode(String(entry.value)));const max=document.createElement('small');max.textContent=` / ${entry.max}`;value.append(max);}
        }
        updatePlayerReview(this.panel, this.reviewPlayerEntries());
        if (form.dataset.form === 'player-progression') this.playerEditName = String(data.get('playerCurrentName') ?? '');
        if (form.dataset.form === 'create-campaign') {
            this.playerDraft = Object.fromEntries(['playerName', 'playerConcept', 'playerRelationship', 'attributeBody', 'attributeInsight', 'attributeRapport'].map(k => [k, data.get(k) ?? '']));
            this.setupNotice = '有未保存的修改。保存后可供其他聊天使用。';
            const status = this.panel?.querySelector('[data-setup-notice]'); if (status) status.textContent = this.setupNotice;
        }
    }

    async handlePlayerAction(action, data) {
        if (action === 'player-show') { this.screen = 'player-state'; this.render(); return; }
        if (action === 'player-back') { this.screen = 'welcome'; this.render(); return; }
        if (action === 'player-cancel-edit') { this.playerEntries = []; this.screen = 'player-state'; this.render(); return; }
        if (action === 'player-edit') {
            this.removedPlayerEntry=null;
            const view = this.getViewModel();
            if (!view.canEditPlayer) { this.localError = '请先完成当前推进，再编辑角色状态。'; this.render(); return; }
            this.playerEntries = editablePlayerEntries(view.player.progression?.entries ?? []);
            this.playerEditName = view.player.name;
            this.playerEditRevision = view.revision; this.playerEditKey = view.campaignKey;
            this.screen = 'player-editor'; this.render(); return;
        }
        if(action==='player-open-entry'||action==='player-entry-menu') {
            const card=this.panel.querySelector(`[data-player-entry="${data.entryId}"]`);
            if(action==='player-open-entry'){card.querySelector('details').open=true;card.querySelector('.cw-entry-swipe').scrollTo({left:0});(data.focusIssue==='true'&&card.querySelector('[aria-invalid="true"]')||card.querySelector('.cw-entry-editor input:not([type="hidden"])'))?.focus();}
            else {const row=card.querySelector('.cw-entry-swipe');row.scrollTo({left:row.scrollLeft>10?0:row.scrollWidth,behavior:'smooth'});}return;
        }
        this.capturePlayerDraft();
        const entry = this.playerEntries.find(e => e.id === data.entryId);
        if (action === 'player-add-entry') {
            if (this.playerEntries.length >= PLAYER_FORM_LIMITS.entries) { this.localError = '最多添加 12 项数值和技能。'; this.render(); return; }
            this.playerEntries.push(newPlayerEntry(data.kind ?? 'resource'));
        }
        if (action === 'player-remove-entry' && entry) {this.removedPlayerEntry={entry:structuredClone(entry),index:this.playerEntries.indexOf(entry)};this.playerEntries=this.playerEntries.filter(e=>e.id!==data.entryId);}
        if (action === 'player-undo-remove' && this.removedPlayerEntry && this.playerEntries.length<12) {this.playerEntries.splice(this.removedPlayerEntry.index,0,this.removedPlayerEntry.entry);this.removedPlayerEntry=null;}
        if (action === 'player-toggle-entry' && entry) entry.enabled=entry.enabled===false;
        if (action === 'player-add-rule' && entry && entry.rules.length < PLAYER_FORM_LIMITS.rules) entry.rules.push({ id: playerId(), condition: '', delta: 5, timing: 'action' });
        if (action === 'player-add-threshold' && entry && entry.thresholds.length < PLAYER_FORM_LIMITS.thresholds) entry.thresholds.push({ id: playerId(), operator: 'gte', value: entry.max, reaction: '', mode: 'while' });
        if (action === 'player-remove-rule' && entry) entry.rules = entry.rules.filter(r => r.id !== data.itemId);
        if (action === 'player-remove-threshold' && entry) entry.thresholds = entry.thresholds.filter(t => t.id !== data.itemId);
        this.render();
        const fieldset = action === 'player-add-entry' ? this.panel?.querySelector('.cw-player-entry:last-child') : entry ? this.panel?.querySelector(`[data-player-entry="${entry.id}"]`) : null;
        if (action.startsWith('player-add-') && fieldset) fieldset.querySelector('details').open=true;
        if (action.startsWith('player-add-')) fieldset?.scrollIntoView({ block: 'nearest' });
    }

    captureAuthoringDraft(event) {
        const target = event.target;
        const form = target?.closest?.('[data-form]');
        if (form?.dataset.form === 'edit-scenario' && target.dataset.scriptField) this.captureScriptDraft(form);
        if (form?.dataset.form === 'revise-scenario') {
            const data = new FormData(form), hash = this.scenarioDocument.hash;
            this.revisionRequests[hash] = String(data.get('revisionRequest') ?? '');
            const prior = this.revisionSelections[hash] ?? {mode:'selected',ids:[]};
            this.revisionSelections[hash] = {mode:String(data.get('rewriteMode') ?? 'selected'), ids: target.name === 'rewriteMode' ? prior.ids : data.getAll('rewriteSections').map(String)};
            if (target.name === 'rewriteMode') this.render();
            if (target.name === 'rewriteSections') { const summary=form.querySelector('.cw-rewrite-selection summary'); if(summary) summary.textContent=`选择改写部分（已选 ${this.revisionSelections[hash].ids.length} 处）`; }
        }
        if (target?.name === 'scriptGroup') { this.scriptGroup = target.value; this.render(); this.panel.querySelector('[name="scriptGroup"]')?.focus(); }

        if (['create-campaign', 'player-progression'].includes(form?.dataset.form)) this.capturePlayerDraft(form);
        if (form?.dataset.form === 'api-profile') {
            this.apiDraft = { ...this.apiDraft, ...apiDraftFromForm(new FormData(form)) };
            if (['endpoint', 'credential', 'noAuth'].includes(target.name)) this.apiModels = [];
        }
        if (form?.dataset.form === 'api-selection') this.apiSelection = apiSelectionFromForm(new FormData(form));
        if(form?.dataset.form==='chapter-modules'){this.chapterModules=readChapterModules(form);}
        if (form?.dataset.form === 'write-custom-scenario') {
            this.scenarioDocument = null; this.scriptEditing = false; this.scriptGroup = '全部'; this.scriptDrafts = {}; this.revisionRequests = {};
        this.authoringDraft = customScenarioInputFromFormData(new FormData(form));
            if (target.name === 'useWorldInfo') {
                const keywords = this.panel?.querySelector('#cw-world-anchors');
                if (keywords) keywords.hidden = !this.authoringDraft.useWorldInfo;
            }
        }
    }

    async run(action, operation) {
        if (this.busyAction) return;
        this.busyAction = action;
        this.localError = '';
        this.render();
        try {
            await operation();
            this.reconcileScreen();
        } catch (error) {
            this.localError = messageOf(error);
        } finally {
            this.busyAction = '';
            this.render();
        }
    }

    captureScriptDraft(form = this.panel?.querySelector('[data-form="edit-scenario"]')) {
        if(!form || !this.scenarioDocument) return;
        this.scriptDrafts[this.scenarioDocument.hash] = { ...(this.scriptDrafts[this.scenarioDocument.hash] ?? {}), ...Object.fromEntries(new FormData(form)) };
    }
    openScript(input, editing = false) {
        this.scenarioDocument = this.app.getScenarioDocument(input); this.scriptEditing = editing && this.scenarioDocument.editable;
        this.chapterModules=null;this.scriptSectionTitle=null;this.scriptInlineKey=null;this.scriptGroup = '全部'; this.screen = 'script';
    }
    async afterAuthoring(scenario) {
        await this.refreshScenarios();
        const review = this.app.getAuthoringJob?.()?.reviewReady;
        this.openScript(review ? { source: 'review' } : { id: scenario.id });
        if (!review && this.reviewPlayerEntries(this.app.getScenarioSetup(scenario.id).playerEntries).length) {
            this.openScenarioSetup(scenario.id);
            this.setupNotice = '剧本已生成，数值与技能草稿已保留。请修改标出的项目，再绑定故事。';
        }
    }
    async handleScriptAction(action, data) {
        const doc = this.scenarioDocument;
        if(action === 'script-group') {this.scriptGroup=data.group;this.scriptSectionTitle=null;this.scriptInlineKey=null;return;}
        if(action === 'script-section'){this.scriptSectionTitle=data.sectionTitle;this.scriptInlineKey=null;return;}
        if(action === 'script-inline-open') {
            if(doc.builtin){this.scenarioDocument=await this.app.copyScenario(doc);this.scenarioDocument.notice='已另存为你的副本，可在这里直接修改。';}
            if(!this.scenarioDocument.editable)throw new Error('这份剧本当前不可编辑。');
            this.scriptInlineKey=data.fieldKey;this.scriptEditing=false;return;
        }
        if(action === 'script-inline-cancel'){if(this.scriptDrafts[doc.hash])delete this.scriptDrafts[doc.hash][data.fieldKey];this.scriptInlineKey=null;return;}
        if(action === 'script-inline-save') {
            const value=this.scriptDrafts[doc.hash]?.[data.fieldKey];
            if(value===undefined)throw new Error('请先填写要保存的内容。');
            const sectionIndex=doc.sections.findIndex(s=>s.fields.some(f=>f.key===data.fieldKey));
            this.scenarioDocument=await this.app.saveScenarioEdits({id:doc.id,expectedHash:doc.hash,changes:{[data.fieldKey]:value}});
            this.scriptSectionTitle=this.scenarioDocument.sections[sectionIndex]?.title;
            const remaining={...this.scriptDrafts[doc.hash]};delete remaining[data.fieldKey];delete this.scriptDrafts[doc.hash];this.scriptDrafts[this.scenarioDocument.hash]=remaining;
            this.scriptInlineKey=null;return;
        }
        if(action === 'script-view' || action === 'script-edit-open') { this.openScript({ id: data.scenarioId }, action === 'script-edit-open'); return; }
        if(action === 'script-current') { this.openScript({source:'current'}); return; }
        if(action === 'script-review') { this.openScript({source:'review'}); return; }
        if(!doc) throw new Error('请先选择一个剧本。');
        if(action === 'script-rewrite-section') { this.revisionSelections[doc.hash] = {mode:'selected',ids:[data.sectionId]}; this.scriptEditing=false; return; }
        if(action === 'script-rewrite') { this.scriptEditing=false; return; }
        if (action === 'script-opening-choice' || action === 'script-edit-opening') {
            if (!doc.editable) throw new Error('请先另存副本，再修改开场。');
            const field = doc.sections.flatMap(section => section.fields).find(field => field.type === 'scene');
            const selected = this.scriptDrafts[doc.hash]?.startSceneId ?? field?.value;
            const option = field?.options.find(option => option.value === selected);
            this.scriptEditing = true; this.scriptGroup = action === 'script-edit-opening' ? '场景' : '概览';
            this.openingFocusKey = action === 'script-edit-opening' ? option?.titleKey : 'startSceneId';
            this.scriptSectionTitle=doc.sections.find(s=>s.fields.some(f=>f.key===this.openingFocusKey))?.title;
            return;
        }
        if(action === 'script-edit') { this.scriptEditing = doc.editable; return; }
        if(action === 'script-cancel-edit') { delete this.scriptDrafts[doc.hash]; this.scriptEditing = false; return; }
        if(action === 'script-copy') { this.scenarioDocument = await this.app.copyScenario(doc); this.scriptEditing = true; await this.refreshScenarios(); return; }
        if(action === 'script-restore') { this.scenarioDocument = await this.app.restorePreviousScenario({id:doc.id,expectedHash:doc.hash}); await this.refreshScenarios(); return; }
        if(action === 'script-accept') { this.scenarioDocument = await this.app.acceptScenarioRevision({jobId:doc.jobId}); await this.refreshScenarios(); return; }
        if(action === 'script-library-version') { this.openScript({id:doc.id}); return; }
        if(action === 'script-export') { this.downloadJson(await this.app.exportScenarioDocument(doc), `${doc.title}-剧本.json`); return; }
        if(action === 'script-start') {
            this.openScenarioSetup(doc.id); this.scriptEditing=false; return;
        }
    }
    downloadJson(content, filename) {
        const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
        try { const link=document.createElement('a'); link.href=url; link.download=safeFilename(filename); link.click(); }
        finally { URL.revokeObjectURL(url); }
    }
    openScenarioSetup(id) {
        this.removedPlayerEntry=null;this.previousPlayerEntries=null;
        const setup = this.app.getScenarioSetup(id);
        this.scenarioSetup = setup; this.selectedScenarioId = id;
        this.playerDraft = structuredClone(setup.playerDraft);
        if (!this.playerDraft.playerName.trim()) this.playerDraft.playerName=String(setup.persona?.name ?? '').slice(0,120);
        this.playerEntries = editablePlayerEntries(setup.playerEntries);
        this.playerEditKey = null; this.screen = 'player';
        this.setupNotice = this.reviewPlayerEntries(this.playerEntries).length ? '草稿已保留，请修改标出的项目；也可以先保存，稍后继续。' : setup.revision ? '剧本设置已保存。可直接绑定当前聊天，也可以绑定其他聊天。' : '设置保存在剧本库中，不依赖当前聊天。';
    }
    async saveScenarioSetup() {
        const saved = await this.app.saveScenarioSetup({ scenarioId: this.selectedScenarioId, expectedRevision: this.scenarioSetup?.revision ?? null, playerDraft: this.playerDraft, playerEntries: this.playerEntries });
        this.scenarioSetup = saved;
        this.setupNotice = this.reviewPlayerEntries(this.playerEntries).length ? '草稿已保存。标出的项目修改后才能绑定故事。' : '已保存到剧本库。下次打开这个剧本即可使用，无需导出或重复设置。';
    }
    async perform(action, data = {}) {
        if(action.startsWith('outline-')) {
            if(this.busyAction)return;
            const form=this.panel.querySelector('[data-form="chapter-modules"], [data-form="write-custom-scenario"]');if(!form)return;
            const existing=form.dataset.form==='chapter-modules';let chapters=readChapterModules(form);const i=Number(data.index);
            if(action==='outline-add'&&chapters.length<64)chapters.push(newChapterModule());
            if(action==='outline-remove')chapters.splice(i,1);
            if(action==='outline-up'&&i>0)[chapters[i-1],chapters[i]]=[chapters[i],chapters[i-1]];
            if(action==='outline-down'&&i<chapters.length-1)[chapters[i+1],chapters[i]]=[chapters[i],chapters[i+1]];
            if(action==='outline-drop'){const [m]=chapters.splice(Number(data.from),1);chapters.splice(i,0,m);}
            if(action==='outline-count'){const count=Number(new FormData(form).get('chapterCount'));if(!Number.isInteger(count)||count<(existing?1:0)||count>64){this.localError='请填写有效的章节数量（最多64章）。';this.render();return;}while(chapters.length<count)chapters.push(newChapterModule());chapters=chapters.slice(0,count);}
            if(existing)this.chapterModules=chapters;else this.authoringDraft={...customScenarioInputFromFormData(new FormData(form)),chapterOutline:chapters};
            if(action==='outline-rewrite') {const doc=this.scenarioDocument;if(!chapters.length){this.localError='至少保留一章。';this.render();return;}await this.run(action,async()=>{const result=await this.app.reviseScenario({id:doc.id,expectedHash:doc.hash,request:'按照用户调整后的章节大纲重新编排剧情衔接，保留未要求改变的人物与世界设定。',chapterOutline:chapters});await this.afterAuthoring(result);});}
            else this.render();return;
        }

        if(action==='library-delete'||action==='library-restore'){
            await this.run(action,async()=>{
                if(action==='library-delete'){const doc=this.app.getScenarioDocument({id:data.scenarioId});await this.app.deleteScenario({id:doc.id,expectedHash:doc.hash});}
                else await this.app.restoreDeletedScenario(data.scenarioId);
                await this.refreshScenarios();
            });return;
        }

        if(action==='chapter-cancel'){this.app.cancelChapterGeneration();return;}
        if (action.startsWith('chapter-')) {
            if(action==='chapter-open') { await this.run(action,async()=>{this.chapterDraft=this.app.getChapterDraft();this.screen='chapter-editor';});return; }
            this.chapterDraft=readChapterForm(this.panel,this.chapterDraft);
            if(!this.chapterDraft)return;
            const scenes=this.chapterDraft.chapter.scenes,index=Number(data.index);
            if(action==='chapter-add'&&scenes.length<8)scenes.push(emptyChapterScene());
            if(action==='chapter-remove'&&Number.isInteger(index))scenes.splice(index,1);
            if(action==='chapter-up'&&index>0)[scenes[index-1],scenes[index]]=[scenes[index],scenes[index-1]];
            if(action==='chapter-down'&&index<scenes.length-1)[scenes[index+1],scenes[index]]=[scenes[index],scenes[index+1]];
            await this.run(action,async()=>{
                if(action==='chapter-rebase') {const fresh=this.app.getChapterDraft();this.chapterDraft={...this.chapterDraft,owner:fresh.owner,baseHash:fresh.currentBaseHash,baseRevision:fresh.currentBaseRevision,sceneOptions:fresh.sceneOptions};}
                if(action==='chapter-write')this.chapterDraft=await this.app.writeChapterDraft(this.chapterDraft);
                else { this.chapterDraft=await this.app.saveChapterDraft(this.chapterDraft);
                    if(action==='chapter-accept'){await this.app.acceptChapterDraft(this.chapterDraft);this.screen='welcome';this.activeTab='chapter';}
                    if(action==='chapter-back')this.screen='welcome';
                }
            });return;
        }

        if (action === 'write-player-entries') {
            this.capturePlayerDraft();
            await this.run(action,async()=>{
                const entries=await this.app.generateScenarioPlayerEntries({scenarioId:this.selectedScenarioId,playerDraft:this.playerDraft,playerEntries:this.playerEntries});
                this.previousPlayerEntries=structuredClone(this.playerEntries);this.playerEntries=entries;
                this.setupNotice=this.reviewPlayerEntries(entries).length?'数值与技能草稿已生成。请修改标出的项目，也可以先保存草稿。':'数值与技能已生成，请检查并编辑；保存剧本设置后生效。';
            });return;
        }
        if (action === 'undo-generated-entries' && this.previousPlayerEntries) {this.playerEntries=this.previousPlayerEntries;this.previousPlayerEntries=null;this.setupNotice='已恢复生成前的条目，尚未保存。';this.render();return;}

        if (action === 'setup-open') { await this.run(action, () => this.openScenarioSetup(String(data.scenarioId))); return; }
        if (action === 'save-scenario-setup') { this.capturePlayerDraft(); await this.run(action, () => this.saveScenarioSetup()); return; }

        if (action.startsWith('script-')) {
            const savedPosition={top:this.panel?.querySelector('.cw-panel-main')?.scrollTop??0,open:[...(this.panel?.querySelectorAll('[data-script-section][open]')??[])].map(e=>e.dataset.scriptSection)};
            const inline=this.panel?.querySelector('[data-inline-field] [data-script-field]');
            if(inline&&this.scenarioDocument)this.scriptDrafts[this.scenarioDocument.hash]={...this.scriptDrafts[this.scenarioDocument.hash],[inline.name]:inline.value};
            this.captureScriptDraft();
            await this.run(action, () => this.handleScriptAction(action, data));
            if(action.startsWith('script-inline-')){this.panel.querySelectorAll('[data-script-section]').forEach(e=>{if(savedPosition.open.includes(e.dataset.scriptSection))e.open=true;});this.panel.querySelector('.cw-panel-main').scrollTop=savedPosition.top;if(action==='script-inline-open')this.panel.querySelector('[data-inline-field] textarea, [data-inline-field] input')?.focus({preventScroll:true});}
            if(action==='script-group')this.panel.querySelector(`[data-action="script-group"][data-group="${CSS.escape(data.group)}"]`)?.focus({preventScroll:true});
            if (['script-opening-choice', 'script-edit-opening'].includes(action) && this.openingFocusKey) {
                const field = this.panel?.querySelector(`[name="${this.openingFocusKey}"]`);
                const section = field?.closest('details'); if (section) section.open = true;
                field?.scrollIntoView({ block: 'center' }); field?.focus();
            }
            if (['script-rewrite', 'script-rewrite-section'].includes(action)) {
                const field = this.panel?.querySelector('[name="revisionRequest"]');
                field?.closest('details.cw-script-revision')?.setAttribute('open','');
                field?.scrollIntoView({ block: 'center' }); field?.focus();
            }
            return;
        }
        if (action.startsWith('player-')) { await this.handlePlayerAction(action, data); return; }
        if (action === 'resume-authoring' || action === 'replan-authoring') {
            await this.run(action, async () => {
                const scenario = await this.app.resumeAuthoring({ replan: action === 'replan-authoring' });
                await this.afterAuthoring(scenario);
            }); return;
        }
        if (action === 'discard-authoring') { await this.run(action, async () => { await this.app.discardAuthoring(); if(this.scenarioDocument?.source === 'review') { this.openScript({id:this.scenarioDocument.id}); } }); return; }
        if (action === 'show-api-settings') {
            const config = this.app.getApiConfiguration();
            this.apiSelection = { directorProfileId: config.directorProfileId };
            this.screen = 'api-settings'; this.render(); return;
        }
        if (action === 'new-api-profile') { this.apiDraft = emptyApiDraft(); this.apiModels = []; this.apiNotice = ''; this.render(); return; }
        if (action === 'edit-api-profile') {
            const profile = this.app.getApiConfiguration().profiles.find(item => item.id === data.profileId);
            if (profile) this.apiDraft = { ...profile, credential: '' };
            this.apiModels = []; this.apiNotice = ''; this.render();
            this.panel?.querySelector('[data-form="api-profile"]')?.scrollIntoView({ block: 'start' }); return;
        }
        if (action === 'delete-api-profile') {
            if (window.confirm('删除这套已保存的接口配置？正在使用的配置需先更换。')) await this.run(action, async () => {
                await this.app.deleteApiProfile(data.profileId);
                if (this.apiDraft.id === data.profileId) this.apiDraft = emptyApiDraft();
                this.apiNotice = '接口配置已删除。';
            });
            return;
        }
        if (action === 'list-api-models' || action === 'test-api-profile') {
            const form = this.panel?.querySelector('[data-form="api-profile"]');
            this.apiDraft = { ...this.apiDraft, ...apiDraftFromForm(new FormData(form)) };
            await this.run(action, async () => {
                if (action === 'list-api-models') {
                    this.apiModels = await this.app.listApiModels(this.apiDraft);
                    this.apiNotice = `已获取 ${this.apiModels.length} 个模型，点击模型输入框选择，也可手动填写。`;
                } else this.apiNotice = await this.app.testApiProfile(this.apiDraft);
            }); return;
        }
        if (action === 'cancel-api-request') { this.app.cancelAuxiliaryRequests(); return; }
        if (action === 'close') { this.close(); return; }
        if (action === 'dismiss-error') { this.localError = ''; this.render(); return; }
        if (action === 'show-scenarios') {
            this.screen = 'scenarios';
            await this.refreshScenarios();
            return;
        }
        if (action === 'back-welcome') { this.screen = 'welcome'; this.render(); return; }
        if (action === 'back-scenarios') { this.screen = 'scenarios'; this.render(); return; }
        if (action === 'show-authoring') { this.screen = 'authoring'; this.render(); return; }
        if (action === 'select-scenario') {
            if (this.playerEditKey) { this.playerEntries = []; this.playerEditKey = null; }
            this.selectedScenarioId = String(data.scenarioId ?? '');
            this.screen = 'player';
            this.render();
            return;
        }
        if (action === 'set-tab') { this.activeTab = String(data.tab ?? 'now'); this.render(); return; }
        if (action === 'enter-world') await this.run(action, () => this.app.enterWorld());
        if (action === 'roll-check') await this.run(action, () => this.app.rollPendingCheck());
        if (action === 'retry-pending') await this.run(action, () => this.app.retryPending());
        if (action === 'cancel-pending') {
            if (window.confirm('放弃这次尚未完成的推进？已经提交的剧情事实不会撤销。')) await this.run(action, () => this.app.cancelPending());
        }
        if (action === 'end-campaign') {
            const phase = normalizeViewModel(this.getViewModel()).phase;
            const confirmationText = phase === 'ready'
                ? '放弃这次尚未开场的旅程，并清除本聊天中的导演状态？'
                : '结束当前旅程并清除本聊天中的导演状态？如需备份请先导出旅程；剧本库及开局设置仍会保留。';
            if (window.confirm(confirmationText)) await this.run(action, () => this.app.endCampaign());
        }
        if (action === 'enable') await this.run(action, () => this.app.setEnabled(true));
        if (action === 'export-save') await this.run(action, () => this.downloadSave());
        if (action === 'import-scenario') this.panel?.querySelector('#cw-import-scenario')?.click();
        if (action === 'import-save') this.panel?.querySelector('#cw-import-save')?.click();
    }

    async handleClick(event) {
        const target = event.target.closest('[data-action]');
        if (!target || target.disabled || (this.busyAction && !['close', 'cancel-api-request', 'chapter-cancel'].includes(target.dataset.action))) return;
        if (target.dataset.action === 'submit-create' || target.dataset.action === 'submit-custom-scenario') {
            target.closest('form')?.requestSubmit();
            return;
        }
        await this.perform(target.dataset.action, target.dataset);
    }

    async handleSubmit(event) {
        event.preventDefault();
        const form = event.target;
        if(form.dataset.form==='chapter-modules'){this.chapterModules=readChapterModules(form);return;}
        if(form.matches('[data-chapter-form]')){await this.perform('chapter-save');return;}
        if (form.dataset.form === 'edit-scenario') {
            this.captureScriptDraft(form); const doc=this.scenarioDocument;
            await this.run('save-scenario', async () => { this.scenarioDocument=await this.app.saveScenarioEdits({id:doc.id,expectedHash:doc.hash,changes:this.scriptDrafts[doc.hash]}); delete this.scriptDrafts[doc.hash]; this.scriptEditing=false; await this.refreshScenarios(); }); return;
        }
        if (form.dataset.form === 'revise-scenario') {
            const doc=this.scenarioDocument, formData=new FormData(form), request=String(formData.get('revisionRequest')??''); this.revisionRequests[doc.hash]=request;
            const sectionIds=formData.get('rewriteMode') === 'all' ? undefined : formData.getAll('rewriteSections').map(String);
            await this.run('revise-scenario', async () => { const scenario=await this.app.reviseScenario({id:doc.id,expectedHash:doc.hash,request,sectionIds}); await this.afterAuthoring(scenario); }); return;
        }
        if (form.dataset.form === 'player-progression') {
            this.capturePlayerDraft(form);
            await this.run('save-player-state', async () => {
                await this.app.updatePlayerProgression({ name: this.playerEditName.trim(), entries: numericPlayerEntries(this.playerEntries), expectedRevision: this.playerEditRevision, campaignKey: this.playerEditKey });
                this.screen = 'player-state'; this.playerEntries = [];
            }); return;
        }
        if (form.dataset.form === 'api-profile') {
            const input = apiDraftFromForm(new FormData(form));
            this.apiDraft = { ...this.apiDraft, ...input };
            await this.run('save-api-profile', async () => {
                const profile = await this.app.saveApiProfile(input);
                this.apiDraft = { ...profile, credential: '' };
                this.apiNotice = '接口配置已保存。可以在上方选择给导演使用。';
            }); return;
        }
        if (form.dataset.form === 'api-selection') {
            this.apiSelection = apiSelectionFromForm(new FormData(form));
            await this.run('select-api-profiles', async () => {
                await this.app.selectApiProfiles(this.apiSelection);
                this.apiNotice = '导演 API 使用设置已保存。';
            }); return;
        }
        if (form.dataset.form === 'write-custom-scenario') {
            const input = customScenarioInputFromFormData(new FormData(form));
            this.scenarioDocument = null; this.scriptEditing = false; this.scriptGroup = '全部'; this.scriptDrafts = {}; this.revisionRequests = {};
        this.authoringDraft = input;
            await this.run('write-custom-scenario', async () => {
                const scenario = await this.app.writeCustomScenario(input);
                await this.afterAuthoring(scenario);
            });
            return;
        }
        if (form.dataset.form !== 'create-campaign') return;
        this.capturePlayerDraft(form);
        const formData = new FormData(form);
        let input;
        try { input = campaignInputFromFormData(formData, this.selectedScenarioId); }
        catch (error) { this.localError = messageOf(error); this.render(); return; }
        const campaignKey = this.app.getScenarioContextKey?.();
        await this.run('create-campaign', async () => {
            await this.saveScenarioSetup();
            await this.app.bindScenarioToCurrentChat({ scenarioId: input.scenarioId, campaignKey, expectedSetupRevision: this.scenarioSetup.revision });
            this.screen = 'welcome';
        });
    }

    async handleFileChange(event) {
        const input = event.target.closest('[data-file-kind]');
        if (!input) return;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        await this.run(`import-${input.dataset.fileKind}`, async () => {
            const payload = await parseJsonFile(file);
            if (input.dataset.fileKind === 'scenario') {
                await this.app.importScenario(payload);
                await this.refreshScenarios();
                this.screen = 'scenarios';
                return;
            }
            const phase = normalizeViewModel(this.getViewModel()).phase;
            if (!['empty', 'ended'].includes(phase) && !window.confirm('导入保存会替换当前聊天中的这次旅程。确定继续？')) return;
            await this.app.importSave(payload);
        });
    }

    async downloadSave() {
        const payload = await Promise.resolve(this.app.exportSave());
        const content = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
        const view = normalizeViewModel(this.getViewModel());
        const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
        try {
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `${safeFilename(view.scenario.title)}-旅程.json`;
            anchor.click();
        } finally {
            URL.revokeObjectURL(url);
        }
    }
}

export class RpgDirectorUi extends DirectorUi {}
