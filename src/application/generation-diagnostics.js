/** Bounded, private receipts. Public UI never receives response text or credentials. */
const ownerOf = identity => JSON.stringify([identity.characterId, identity.chatId]);
export function generationDiagnosticView(adapter, identity) {
    if (!identity) return null;
    const receipt = (adapter.getSettings().generationDiagnostics ?? []).find(r => r.owner === ownerOf(identity));
    if (!receipt) return null;
    const { content, owner, ...visible } = receipt;
    return visible;
}
export async function recordGenerationFailure(adapter, identity, error) {
    const settings = adapter.getSettings();
    const d = error.diagnostic;
    if (!d) return;
    let content = String(d.content ?? '').slice(0, 120000);
    for (const profile of settings.auxiliaryApis?.profiles ?? []) if (profile.credential) content = content.replaceAll(profile.credential, '[密钥已隐藏]');
    const receipt = { ...d, content, code: error.code, owner: ownerOf(identity) };
    const next = { ...settings, generationDiagnostics: [...(settings.generationDiagnostics ?? []).filter(r => r.owner !== receipt.owner).slice(-15), receipt] };
    if (adapter.persistApiSettings) await adapter.persistApiSettings(next); else await adapter.saveSettings(next);
}
