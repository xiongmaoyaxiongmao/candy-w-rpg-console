import { EXTENSION_NAME } from './src/domain.js';
import { PerChatRepository } from './src/repository.js';
import { RpgApplication } from './src/application.js';
import { SillyTavernAdapter } from './src/sillytavern-adapter.js';
import { RpgConsoleUi } from './src/ui.js';

const adapter = new SillyTavernAdapter();
const application = new RpgApplication({ repository: new PerChatRepository(adapter), adapter });
const ui = new RpgConsoleUi(application, adapter);

function installSettings() {
    const settings = adapter.getSettings();
    adapter.saveSettings(settings);
    const host = document.createElement('div');
    host.id = 'cwrpc-v1-settings';
    host.innerHTML = `<div class="cwrpc-settings-title">Candy W 跑团控制台 v1</div><label><input type="checkbox" data-setting="enabled" ${settings.enabled ? 'checked' : ''}> 启用跑团控制台</label><label><input type="checkbox" data-setting="showButton" ${settings.showButton ? 'checked' : ''}> 显示“🎲 跑团”入口</label><p>关闭插件会清空唯一的跑团上下文注入；不会修改角色卡、世界书或聊天正文。</p>`;
    host.addEventListener('change', event => {
        const target = event.target;
        const next = { ...adapter.getSettings(), [target.dataset.setting]: target.checked };
        try {
            if (target.dataset.setting === 'enabled') application.setEnabled(target.checked);
            adapter.saveSettings(next);
            ui.render();
        } catch (error) {
            target.checked = !target.checked;
            window.toastr?.error?.(error.message) ?? window.alert(error.message);
        }
    });
    document.querySelector('#extensions_settings')?.append(host);
}

function initialize() {
    application.enabled = adapter.getSettings().enabled;
    installSettings();
    ui.mount();
    void application.sync();
    adapter.onChatChanged(() => application.onChatChanged());
}

jQuery(() => initialize());

void EXTENSION_NAME;
