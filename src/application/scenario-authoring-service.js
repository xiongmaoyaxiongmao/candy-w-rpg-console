import { compileWorldInfoScanSeed } from '../compilation/index.js';
import {
    assertWorldInfoScenarioRequest,
    buildCustomScenarioPrompt,
    buildScenarioRevisionPrompt,
    buildWorldInfoScenarioPrompt,
    parseAndFinalizeCustomScenario,
    parseAndFinalizeScenarioRevision,
} from '../protocol/index.js';

const AUTHORING_RESPONSE_LENGTH = 8_000;

export class ScenarioAuthoringService {
    constructor({ adapter, assertMayContinue }) {
        if (!adapter || typeof adapter.generateRawText !== 'function') throw new Error('ScenarioAuthoringService 需要正式宿主 adapter。');
        if (typeof assertMayContinue !== 'function') throw new Error('ScenarioAuthoringService 需要聊天连续性校验。');
        this.adapter = adapter;
        this.assertMayContinue = assertMayContinue;
    }

    async writeBrief(brief, identity) {
        return await this.#write(
            buildCustomScenarioPrompt(brief),
            identity,
            '剧本编写',
            raw => parseAndFinalizeCustomScenario(raw),
        );
    }

    async writeFromWorldInfo(input, identity) {
        const request = assertWorldInfoScenarioRequest(input);
        const scanSeed = compileWorldInfoScanSeed([request.title, request.outcome, request.anchors].filter(Boolean));
        const nativeWorldInfo = await this.adapter.collectNativeWorldInfo(scanSeed, identity);
        this.assertMayContinue(identity, '世界书扫描');
        return await this.#write(
            buildWorldInfoScenarioPrompt(request, nativeWorldInfo),
            identity,
            '剧本编写',
            raw => parseAndFinalizeCustomScenario(raw),
        );
    }

    async revise(request, source, identity) {
        return await this.#write(
            buildScenarioRevisionPrompt(request, source),
            identity,
            '剧本修改',
            raw => parseAndFinalizeScenarioRevision(raw, { scenarioId: source.id, contentVersion: source.contentVersion }),
        );
    }

    async #write(instruction, identity, stage, finalize) {
        const raw = await this.adapter.generateRawText(instruction, identity, { responseLength: AUTHORING_RESPONSE_LENGTH });
        this.assertMayContinue(identity, stage);
        return finalize(raw);
    }
}
