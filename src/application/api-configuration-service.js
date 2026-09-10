import { parseStructuredCompletion } from '../protocol/structured-output.js';
import { object } from '../domain/json-contract.js';
import { normalizeApiProfile, publicApiProfile, readApiSettings } from '../protocol/api-settings.js';

export class ApiConfigurationService {
    constructor(adapter) { this.adapter = adapter; }
    read() { return readApiSettings(this.adapter.getSettings()); }
    view() {
        const config = this.read();
        return { ...config, profiles: config.profiles.map(publicApiProfile) };
    }
    async write(config) {
        const settings = { ...this.adapter.getSettings(), auxiliaryApis: config };
        if (this.adapter.persistApiSettings) await this.adapter.persistApiSettings(settings);
        else await this.adapter.saveSettings(settings);
    }
    async save(input) {
        const config = this.read();
        const previous = config.profiles.find(p => p.id === input.id);
        if (input.id && !previous) throw new Error('该接口配置已不存在，请重新选择。');
        if (!previous && config.profiles.length >= 24) throw new Error('最多保存 24 套接口配置。');
        const profile = normalizeApiProfile(input, previous);
        if (!profile.id) profile.id = `api-${globalThis.crypto.randomUUID()}`;
        config.profiles = [...config.profiles.filter(p => p.id !== profile.id), profile];
        await this.write(config);
        return publicApiProfile(profile);
    }
    async remove(id) {
        const config = this.read();
        if (config.directorProfileId === id) throw new Error('该配置正在使用，请先更换导演接口。');
        config.profiles = config.profiles.filter(p => p.id !== id);
        await this.write(config);
    }
    async select(input) {
        const config = this.read();
        for (const key of ['directorProfileId']) {
            const id = String(input[key] ?? '');
            if (!id || !config.profiles.some(p => p.id === id)) throw new Error('所选接口配置已不存在。');
            config[key] = id;
        }
        await this.write(config);
    }
    async models(input) {
        const previous = this.read().profiles.find(p => p.id === input.id);
        return await this.adapter.listApiModels(normalizeApiProfile(input, previous, { requireModel: false }));
    }
    async test(input) {
        const previous = this.read().profiles.find(p => p.id === input.id);
        const profile = normalizeApiProfile(input, previous);
        const schema = object({ status: { const: 'OK' } });
        const response = await this.adapter.testStructuredProfile(profile, '连接验证：请返回 status 为 OK 的 JSON 对象。', schema);
        parseStructuredCompletion(response, schema, '结构化连接测试');
        return `验证通过，${profile.model} 已返回符合要求的 JSON。`;
    }
}
