import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiConfigurationService } from '../src/application/api-configuration-service.js';
import { FakeOfficialAdapter } from './support/fake-official-adapter.mjs';

const profile = { label: '导演接口', endpoint: 'https://example.invalid/v1/chat/completions', credential: 'test-value', model: 'test-model' };
test('profiles persist, switch director profiles, preserve omitted credentials, and do not expose them in views', async () => {
    const adapter = new FakeOfficialAdapter();
    const service = new ApiConfigurationService(adapter);
    const director = await service.save(profile);
    const alternate = await service.save({ ...profile, label: '备用接口', model: 'alternate-model' });
    await service.select({ directorProfileId: director.id });
    const reopened = new ApiConfigurationService(adapter);
    assert.equal(reopened.view().directorProfileId, director.id);
    await reopened.select({ directorProfileId: alternate.id });
    assert.equal(reopened.view().directorProfileId, alternate.id);
    assert.ok(!JSON.stringify(reopened.view()).includes('test-value'));
    await reopened.save({ ...director, model: 'another-model', credential: '' });
    assert.equal(reopened.read().profiles.find(p => p.id === director.id).credential, 'test-value');
    await assert.rejects(reopened.save({ ...director, endpoint: 'https://other.invalid', credential: '' }), /重新填写/);
    await assert.rejects(reopened.remove(alternate.id), /正在使用/);
    await assert.rejects(reopened.select({ directorProfileId: '' }));
    await reopened.select({ directorProfileId: director.id });
    await reopened.remove(alternate.id);
    assert.equal(reopened.read().profiles.length, 1);
    await assert.rejects(reopened.save({ ...profile, endpoint: 'https://user:password@example.invalid' }), /密钥/);
});
