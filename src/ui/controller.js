import { normalizeViewModel, renderPanel, renderToggle } from './render.js';

const JSON_FILE_LIMIT = 2 * 1024 * 1024;

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

export class DirectorUi {
    constructor(application) {
        if (!application || typeof application.getViewModel !== 'function' || typeof application.subscribe !== 'function') throw new Error('DirectorUi 需要完整的 application 接口。');
        this.app = application;
        this.open = false;
        this.screen = 'welcome';
        this.activeTab = 'now';
        this.scenarios = [];
        this.selectedScenarioId = '';
        this.localError = '';
        this.busyAction = '';
        this.toggle = null;
        this.panel = null;
        this.previousFocus = null;
        this.unsubscribe = this.app.subscribe(() => {
            this.reconcileScreen();
            this.render();
        });
        this.onKeydown = event => {
            if (event.key === 'Escape' && this.open) this.close();
        };
    }

    mount() {
        if (this.toggle || this.panel) return this;
        this.toggle = document.createElement('button');
        this.toggle.id = 'cw-director-toggle';
        this.toggle.type = 'button';
        this.toggle.className = 'menu_button';
        this.toggle.setAttribute('aria-label', '打开 Candy W 世界入口');
        this.toggle.setAttribute('aria-controls', 'cw-director-panel');
        this.toggle.addEventListener('click', () => this.show());
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
        document.body.append(this.panel);
        document.addEventListener('keydown', this.onKeydown);
        this.refreshScenarios();
        this.render();
        return this;
    }

    destroy() {
        this.unsubscribe?.();
        document.removeEventListener('keydown', this.onKeydown);
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
        this.toggle.innerHTML = renderToggle(viewModel);
        this.toggle.setAttribute('aria-expanded', String(this.open));
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
        });
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
        if (target.dataset.action === 'submit-create') {
            target.closest('form')?.requestSubmit();
            return;
        }
        await this.perform(target.dataset.action, target.dataset);
    }

    async handleSubmit(event) {
        event.preventDefault();
        const form = event.target;
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
