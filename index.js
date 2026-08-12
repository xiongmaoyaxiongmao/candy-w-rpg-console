import { DirectorApplication } from './src/application/index.js';
import { validateDirectorState, validateScenario } from './src/domain/index.js';
import { SillyTavernAdapter } from './src/host/sillytavern-adapter.js';
import { PerChatRepository } from './src/persistence/per-chat-repository.js';
import { DirectorUi } from './src/ui/index.js';

let runtime = null;

function installSettings(application, adapter) {
    document.querySelector('#cw-director-v2-settings')?.remove();
    const settings = adapter.getSettings();
    const host = document.createElement('div');
    host.id = 'cw-director-v2-settings';
    host.innerHTML = `<div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header"><b>Candy W 跑团导演 v2</b></div>
        <div class="inline-drawer-content">
            <label class="checkbox_label"><input type="checkbox" data-cw-setting="enabled" ${settings.enabled ? 'checked' : ''}> 启用看不见的故事导演</label>
            <p>只在当前单角色聊天中工作；沿用当前模型、角色卡、聊天、世界书与原生上下文。关闭会清空本扩展的导演指令与 World Info scan seed。</p>
        </div>
    </div>`;
    host.addEventListener('change', async event => {
        const target = event.target.closest('[data-cw-setting="enabled"]');
        if (!target) return;
        try {
            await application.setEnabled(target.checked);
        } catch (error) {
            target.checked = !target.checked;
            adapter.notifyError(error instanceof Error ? error.message : String(error));
        }
    });
    document.querySelector('#extensions_settings')?.append(host);
    return () => host.remove();
}

async function initializeCandyWDirector() {
    if (runtime) return runtime;
    const adapter = new SillyTavernAdapter();
    const repository = new PerChatRepository({
        adapter,
        validateState: validateDirectorState,
        validateScenario,
    });
    const application = new DirectorApplication({ adapter, repository }).start();
    const ui = new DirectorUi(application).mount();
    const removeSettings = installSettings(application, adapter);
    runtime = { adapter, application, ui, removeSettings };
    return runtime;
}

export async function disableCandyWDirector() {
    const current = runtime;
    runtime = null;
    if (!current) {
        new SillyTavernAdapter().clearDirectorPrompts();
        return;
    }
    current.ui.destroy();
    current.removeSettings();
    await current.application.destroy();
}

globalThis.disableCandyWDirector = disableCandyWDirector;

jQuery(() => {
    void initializeCandyWDirector().catch(error => {
        new SillyTavernAdapter().clearDirectorPrompts();
        globalThis.toastr?.error?.(`Candy W 初始化失败：${error instanceof Error ? error.message : String(error)}`);
    });
});
