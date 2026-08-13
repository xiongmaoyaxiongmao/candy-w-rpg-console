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
const WORLD_INFO_SCENARIO_FIELDS = Object.freeze(['title', 'outcome', 'anchors']);
const SCENARIO_REVISION_FIELDS = Object.freeze(['scenarioId', 'instruction']);

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
    if (allocation.length !== 3 || allocation.some((value, index) => value !== index)) throw new Error('身手、洞察、交涉必须把 +2、+1、+0 各分配一次。');
    return {
        scenarioId: String(formData.get('scenarioId') ?? fallbackScenarioId),
        player: {
            name: String(formData.get('playerName') ?? '').trim(),
            concept: String(formData.get('playerConcept') ?? '').trim(),
            relationship: String(formData.get('playerRelationship') ?? '').trim(),
            attributes,
        },
    };
}

export function customScenarioInputFromFormData(formData) {
    return Object.fromEntries(CUSTOM_SCENARIO_FIELDS.map(field => [field, String(formData.get(field) ?? '').trim()]));
}

export function worldInfoScenarioInputFromFormData(formData) {
    return Object.fromEntries(WORLD_INFO_SCENARIO_FIELDS.map(field => [field, String(formData.get(field) ?? '').trim()]));
}

export function scenarioRevisionInputFromFormData(formData) {
    return Object.fromEntries(SCENARIO_REVISION_FIELDS.map(field => [field, String(formData.get(field) ?? '').trim()]));
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
        this.authoringDraft = Object.fromEntries(CUSTOM_SCENARIO_FIELDS.map(field => [field, '']));
        this.worldAuthoringDraft = Object.fromEntries(WORLD_INFO_SCENARIO_FIELDS.map(field => [field, '']));
        this.revisionDraft = Object.fromEntries(SCENARIO_REVISION_FIELDS.map(field => [field, '']));
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
        this.onPanelInput = event => this.captureAuthoringDraft(event);
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
        if (view.phase !== 'empty') this.screen = 'welcome';
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
        this.panel.innerHTML = renderPanel({
            viewModel,
            screen: this.screen,
            scenarios: this.scenarios,
            selectedScenarioId: this.selectedScenarioId,
            activeTab: this.activeTab,
            localError: this.localError,
            busyAction: this.busyAction,
            authoringDraft: this.authoringDraft,
            worldAuthoringDraft: this.worldAuthoringDraft,
            revisionDraft: this.revisionDraft,
        });
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

    captureAuthoringDraft(event) {
        const target = event.target;
        const form = target?.closest?.('[data-form]');
        if (form?.dataset.form === 'write-custom-scenario' && CUSTOM_SCENARIO_FIELDS.includes(target.name)) {
            this.authoringDraft = { ...this.authoringDraft, [target.name]: String(target.value ?? '') };
        }
        if (form?.dataset.form === 'write-world-info-scenario' && WORLD_INFO_SCENARIO_FIELDS.includes(target.name)) {
            this.worldAuthoringDraft = { ...this.worldAuthoringDraft, [target.name]: String(target.value ?? '') };
        }
        if (form?.dataset.form === 'revise-scenario' && SCENARIO_REVISION_FIELDS.includes(target.name)) {
            this.revisionDraft = { ...this.revisionDraft, [target.name]: String(target.value ?? '') };
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

    async perform(action, data = {}) {
        if (action === 'close') { this.close(); return; }
        if (action === 'dismiss-error') { this.localError = ''; this.render(); return; }
        if (action === 'show-scenarios') {
            const phase = normalizeViewModel(this.getViewModel()).phase;
            if (phase === 'ended') await this.run('end-campaign', () => this.app.endCampaign());
            this.screen = 'scenarios';
            await this.refreshScenarios();
            return;
        }
        if (action === 'back-welcome') { this.screen = 'welcome'; this.render(); return; }
        if (action === 'back-scenarios') { this.screen = 'scenarios'; this.render(); return; }
        if (action === 'show-authoring') { this.screen = 'authoring'; this.render(); return; }
        if (action === 'show-world-authoring') { this.screen = 'world-authoring'; this.render(); return; }
        if (action === 'show-revision') {
            this.revisionDraft = { scenarioId: String(data.scenarioId ?? this.selectedScenarioId), instruction: '' };
            this.screen = 'revision';
            this.render();
            return;
        }
        if (action === 'select-scenario') {
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
                : '结束当前旅程并清除本聊天中的导演状态？如需留档请先保存旅程；导演注入会立即清空。';
            if (window.confirm(confirmationText)) await this.run(action, () => this.app.endCampaign());
        }
        if (action === 'enable') await this.run(action, () => this.app.setEnabled(true));
        if (action === 'export-save') await this.run(action, () => this.downloadSave());
        if (action === 'import-scenario') this.panel?.querySelector('#cw-import-scenario')?.click();
        if (action === 'import-save') this.panel?.querySelector('#cw-import-save')?.click();
    }

    async handleClick(event) {
        const target = event.target.closest('[data-action]');
        if (!target || target.disabled) return;
        if (target.dataset.action === 'submit-create' || target.dataset.action === 'submit-custom-scenario' || target.dataset.action === 'submit-world-info-scenario' || target.dataset.action === 'submit-scenario-revision') {
            target.closest('form')?.requestSubmit();
            return;
        }
        await this.perform(target.dataset.action, target.dataset);
    }

    async handleSubmit(event) {
        event.preventDefault();
        const form = event.target;
        if (form.dataset.form === 'write-custom-scenario') {
            const input = customScenarioInputFromFormData(new FormData(form));
            this.authoringDraft = input;
            await this.run('write-custom-scenario', async () => {
                const scenario = await this.app.writeCustomScenario(input);
                this.selectedScenarioId = String(scenario.id ?? '');
                await this.refreshScenarios();
                this.screen = 'player';
            });
            return;
        }
        if (form.dataset.form === 'write-world-info-scenario') {
            const input = worldInfoScenarioInputFromFormData(new FormData(form));
            this.worldAuthoringDraft = input;
            await this.run('write-world-info-scenario', async () => {
                const scenario = await this.app.writeScenarioFromWorldInfo(input);
                this.selectedScenarioId = String(scenario.id ?? '');
                await this.refreshScenarios();
                this.screen = 'player';
            });
            return;
        }
        if (form.dataset.form === 'revise-scenario') {
            const input = scenarioRevisionInputFromFormData(new FormData(form));
            this.revisionDraft = input;
            await this.run('revise-scenario', async () => {
                const scenario = await this.app.reviseScenario(input);
                this.selectedScenarioId = String(scenario.id ?? '');
                await this.refreshScenarios();
                this.screen = 'player';
            });
            return;
        }
        if (form.dataset.form !== 'create-campaign') return;
        const formData = new FormData(form);
        let input;
        try { input = campaignInputFromFormData(formData, this.selectedScenarioId); }
        catch (error) { this.localError = messageOf(error); this.render(); return; }
        await this.run('create-campaign', () => this.app.createCampaign(input));
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
