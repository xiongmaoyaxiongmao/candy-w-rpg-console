import test from 'node:test';
import assert from 'node:assert/strict';
import { completionEnvelope, parseStructuredCompletion } from '../src/protocol/structured-output.js';
import { object, text, assertContract } from '../src/domain/json-contract.js';
import { AUTHORING_PLAN_CONTRACT, validatePlan } from '../src/protocol/scenario-authoring.js';
import { ScenarioAuthoringService } from '../src/application/scenario-authoring-service.js';
import { FakeOfficialAdapter } from './support/fake-official-adapter.mjs';
import { FOG_HARBOR_SCENARIO } from '../src/scenarios/index.js';
import { structuredRequest } from '../src/host/structured-client.js';
const schema = object({ answer: text(100) });
const envelope = (content, finish_reason = 'stop') => completionEnvelope({ choices: [{ message: { content }, finish_reason }], model: 'receipt-model', usage: { prompt_tokens: 12, completion_tokens: 20 } }, { requestId: 'local-request' });
const brief = { title:'灯塔', premise:'在风暴中抵达灯塔。', tone:'悬疑', setting:'海港', opening:'风暴即将到来。', coreTruth:'灯塔电路被破坏。', npcGoals:'修复灯塔。', timePressure:'风暴迫近。', endings:'修复或撤离。' };
function scenario() { const draft = structuredClone(FOG_HARBOR_SCENARIO); delete draft.hash; draft.id = 'test-authored'; return draft; }
function setup() {
    const adapter = new FakeOfficialAdapter(); const identity = adapter.selectSingle();
    const make = () => new ScenarioAuthoringService({ adapter, assertMayContinue: current => { assert.deepEqual(current, adapter.currentChatIdentity()); if (!adapter.settings.enabled) throw new Error('disabled'); }, changed: () => {} });
    return { adapter, identity, make, service: make() };
}
test('receipts distinguish truncation even for valid JSON, refusal, empty output and malformed JSON', () => {
    assert.deepEqual(parseStructuredCompletion(envelope('{"answer":"有效"}'), schema, '剧本'), {answer:'有效'});
    for (const [response, code] of [[envelope('{"answer":"有效"}', 'length'), 'OUTPUT_TRUNCATED'], [envelope(''), 'EMPTY_OUTPUT'], [envelope('```json\n{"answer":"有效"}\n```'), 'INVALID_JSON'], [envelope('{"answer":"有效"}\n{}'), 'INVALID_JSON'], [envelope('{"answer":"有效","extra":1}'), 'INVALID_FIELDS']]) {
        assert.throws(() => parseStructuredCompletion(response, schema, '剧本'), e => e.code === code && !e.message.includes('行动分类') && e.diagnostic.model === 'receipt-model');
    }
    const refused = completionEnvelope({ choices:[{message:{refusal:'blocked',content:null},finish_reason:'stop'}] });
    assert.throws(() => parseStructuredCompletion(refused, schema, '行动判断'), e => e.code === 'MODEL_REFUSAL');
    assert.equal(completionEnvelope({content:[{type:'thinking',thinking:'private'},{type:'text',text:'{}'}],stop_reason:'end_turn'}).content, '{}');
    assert.throws(() => assertContract(JSON.parse('{"answer":"ok","__proto__":{}}'), schema), /未知字段/);
});
test('direct request preserves receipt and owns format and budget independently of main API', async () => {
    const captured = [];
    const client = { request: async (profile, operation, payload) => { captured.push(payload); return { requestId:'server-id', result:{ choices:[{message:{content:'{"answer":"ok"}'},finish_reason:'stop'}],usage:{completion_tokens:9},model:'actual-model' } }; }, run: fn => fn(new AbortController().signal) };
    const profile = { endpoint:'https://example.invalid', label:'Director', model:'selected', maxOutputTokens:16000, outputMode:'json_object' };
    const result = await structuredRequest(client, profile, 'prompt', schema, {responseLength:64000});
    assert.equal(captured[0].max_tokens,16000); assert.deepEqual(captured[0].response_format,{type:'json_object'});
    assert.equal(result.model,'actual-model'); assert.equal(result.usage.output,9); assert.equal(result.requestId,'server-id');
    await structuredRequest(client, {...profile,outputMode:'json_schema'}, 'prompt', schema);
    assert.deepEqual(captured[1].response_format.json_schema.schema,schema);
    assert.ok(!captured[1].messages[0].content.includes(JSON.stringify(schema)));
});
test('a failed scene resumes after a service reload without repeating its plan or completed scenes', async () => {
    const {adapter,identity,service,make} = setup(); adapter.enqueueScenario(scenario());
    const failedScene = adapter.rawDecisions[2]; adapter.rawDecisions.splice(2, 1, '```bad```', '```bad```', '```bad```');
    await assert.rejects(service.start(identity,'custom',brief,''), /单一 JSON/);
    assert.equal(adapter.settings.importedScenarios.length,0); assert.equal(service.read(identity).scenes.length,1);
    const count = adapter.rawPrompts.length; adapter.rawDecisions.unshift(failedScene);
    const result = await make().resume(identity);
    assert.equal(result.id,'test-authored'); assert.equal(adapter.rawPrompts.length-count,scenario().scenes.length);
    assert.equal(service.read(identity),null); assert.equal(adapter.settings.importedScenarios.length,1); assert.equal(adapter.currentMessages().length,0);
});
test('cancellation and chat switches preserve the owner job without publishing a script to another chat', async () => {
    for (const mode of ['cancel','switch']) {
        const {adapter,identity,service} = setup(); adapter.enqueueScenario(scenario());
        const plan = adapter.rawDecisions[0];
        adapter.rawDecisions[0] = () => { if(mode==='cancel') service.cancel(); else adapter.selectSingle('other.png','other-chat'); return plan; };
        await assert.rejects(service.start(identity,'custom',brief,''));
        assert.equal(service.read(identity).scenes.length,0); assert.equal(adapter.settings.importedScenarios.length,0);
        if(mode==='switch') assert.equal(service.read(adapter.currentChatIdentity()),null);
    }
});
test('failed final persistence keeps the complete draft recoverable and a retry publishes exactly once', async () => {
    const {adapter,identity,service} = setup(); adapter.enqueueScenario(scenario());
    adapter.persistApiSettings = async next => { if(next.importedScenarios.length) throw new Error('disk failure'); adapter.saveSettings(next); };
    await assert.rejects(service.start(identity,'custom',brief,''), /disk failure/);
    assert.equal(adapter.settings.importedScenarios.length,0); assert.equal(service.read(identity).scenes.length,scenario().scenes.length);
    const calls = adapter.rawPrompts.length; adapter.persistApiSettings = async next => adapter.saveSettings(next);
    await service.resume(identity); assert.equal(adapter.rawPrompts.length,calls); assert.equal(adapter.settings.importedScenarios.length,1);
});
test('a malformed plan and unreachable ending fail before any scene is requested', async () => {
    const {adapter,identity,service} = setup(); adapter.enqueueScenario(scenario());
    const plan=JSON.parse(adapter.rawDecisions[0]); plan.endings.push({...plan.endings[0],id:'unreachable'});
    assert.throws(()=>validatePlan(plan),/无法抵达/);
    plan.scenePlans[0].moves[0].nextSceneId='missing';adapter.rawDecisions.splice(0,1,...Array(3).fill(JSON.stringify(plan)));
    await assert.rejects(service.start(identity,'custom',brief,''),/去向无效/);assert.equal(adapter.rawPrompts.length,3);assert.equal(service.read(identity).plan,null);
});

test('native Claude structured tool payload is accepted only for the declared tool and never executed', () => {
    const raw = {content:[{type:'tool_use',name:'director_result',input:{answer:'ok'}}],stop_reason:'tool_use'};
    assert.deepEqual(parseStructuredCompletion(completionEnvelope(raw,{source:'claude'}),schema,'剧本'),{answer:'ok'});
    assert.throws(()=>parseStructuredCompletion(completionEnvelope({...raw,content:[...raw.content,...raw.content]},{source:'claude'}),schema,'剧本'),e=>e.code==='AMBIGUOUS_OUTPUT');
    assert.throws(()=>parseStructuredCompletion(completionEnvelope({...raw,content:[{...raw.content[0],name:'other_tool'}]},{source:'claude'}),schema,'剧本'),e=>e.code==='EMPTY_OUTPUT');
});

test('provider-specific thinking policy never guesses support from a model name on an unknown gateway', async () => {
    const {thinkingParameters}=await import('../src/host/generation-capabilities.js');
    assert.deepEqual(thinkingParameters({chat_completion_source:'custom',custom_url:'https://api.deepseek.com',model:'deepseek-v4-flash-vision-exp'}),{custom:{thinking:{type:'disabled'}}});
    assert.deepEqual(thinkingParameters({chat_completion_source:'custom',custom_url:'https://open.bigmodel.cn/api/paas/v4',model:'glm-5.3-flash'}),{custom:{reasoning_effort:'low'}});
    assert.deepEqual(thinkingParameters({chat_completion_source:'custom',custom_url:'https://unknown.invalid',model:'deepseek-v4-flash'}),{});
    assert.throws(()=>thinkingParameters({chat_completion_source:'custom',custom_url:'https://unknown.invalid'},'disabled'),/只支持/);
});

test('closed provider schemas encode variable maps losslessly and reject duplicate map entries', async () => {
    const {providerSchema}=await import('../src/protocol/provider-schema.js');
    const mapSchema=object({variables:{type:'object',properties:{},required:[],additionalProperties:{type:'boolean'},propertyNames:text(30),maxProperties:4}});
    const wire=providerSchema(mapSchema);
    assert.equal(wire.properties.variables.type,'array');
    const response={...envelope('{"variables":[{"key":"opened","value":true}]}'),wireEncoding:'entries-v1'};
    assert.deepEqual(parseStructuredCompletion(response,mapSchema,'剧本'),{variables:{opened:true}});
    assert.equal(response.content,'{"variables":[{"key":"opened","value":true}]}');
    assert.throws(()=>parseStructuredCompletion({...response,content:'{"variables":[{"key":"opened","value":true},{"key":"opened","value":false}]}'},mapSchema,'剧本'),/重复变量/);
});


test('strict text mode sends schema once, no format parameters and rejects decorated JSON', async () => {
    let payload;
    const client = { request: async (_p,_op,body) => { payload=body; return { result:{choices:[{message:{content:'```json\n{"answer":"ok"}\n```'},finish_reason:'stop'}]} }; }, run: fn => fn(new AbortController().signal) };
    const response=await structuredRequest(client,{endpoint:'https://example.invalid',outputMode:'text_json',model:'unknown'},'classify',schema);
    for(const key of ['response_format','tools','temperature','n']) assert.equal(payload[key],undefined);
    assert.equal(payload.messages[0].content.split(JSON.stringify(schema)).length,2);
    assert.throws(()=>parseStructuredCompletion(response,schema,'行动判断'),e=>e.code==='INVALID_JSON');
});

test('custom tool responses require exactly the declared result and validate its fields', () => {
    const call={type:'function',function:{name:'director_result',arguments:'{"answer":"ok"}'}};
    const raw={choices:[{message:{tool_calls:[call]},finish_reason:'tool_calls'}]};
    assert.deepEqual(parseStructuredCompletion(completionEnvelope(raw,{outputMode:'tool'}),schema,'剧本'),{answer:'ok'});
    const duplicate=structuredClone(raw); duplicate.choices[0].message.tool_calls.push(call);
    assert.throws(()=>parseStructuredCompletion(completionEnvelope(duplicate,{outputMode:'tool'}),schema,'剧本'),e=>e.code==='AMBIGUOUS_OUTPUT');
    const wrong=structuredClone(raw); wrong.choices[0].message.tool_calls[0].function.name='other';
    assert.throws(()=>parseStructuredCompletion(completionEnvelope(wrong,{outputMode:'tool'}),schema,'剧本'),e=>e.code==='EMPTY_OUTPUT');
});
