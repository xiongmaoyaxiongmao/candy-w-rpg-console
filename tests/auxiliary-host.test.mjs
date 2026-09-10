import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const hostStub = dataModule(`export const extension_settings={};export const getContext=()=>globalThis.__candyHost;export const getRequestHeaders=()=>({'Content-Type':'application/json','X-CSRF-Token':'test'});export const eventSource={};export const event_types={};export const extension_prompt_roles={SYSTEM:0};export const extension_prompt_types={IN_PROMPT:0,NONE:-1};export const isGenerating=()=>false;export const saveSettingsDebounced=()=>{};export const saveSettings=async()=>{};export const setExtensionPrompt=()=>{};export const checkWorldInfo=async()=>globalThis.__worldScan;export const DEFAULT_DEPTH=4;export const world_info_position={atDepth:4};export const regex_placement={WORLD_INFO:1};export const getRegexedString=(text)=>text;`);
let clientSource = await readFile(new URL('../src/host/auxiliary-api-client.js', import.meta.url), 'utf8');
clientSource = clientSource.replace(/from ['"]([^'"]+)['"]/gu, (_, path) => `from '${path.endsWith('script.js') ? hostStub : new URL(path,new URL('../src/host/auxiliary-api-client.js',import.meta.url)).href}'`);
const clientUrl = dataModule(clientSource), { AuxiliaryApiClient } = await import(clientUrl);
let adapterSource = await readFile(new URL('../src/host/sillytavern-adapter.js', import.meta.url), 'utf8');
adapterSource=adapterSource.replace(/from ['"]([^'"]+)['"]/gu,(_,p)=>`from '${p==='./auxiliary-api-client.js'?clientUrl:/(?:script|extensions|world-info|engine)\.js$/.test(p)?hostStub:new URL(p,new URL('../src/host/sillytavern-adapter.js',import.meta.url)).href}'`);
const {SillyTavernAdapter} = await import(dataModule(adapterSource));
const profile={id:'p',label:'Director',endpoint:'https://api.example.invalid/v1',credential:'private-value',model:'m',outputMode:'json_object'};
const result={choices:[{message:{content:'{"status":"OK"}'},finish_reason:'stop'}],usage:{completion_tokens:8}};
const frames = (...items) => new Response(items.map(i=>JSON.stringify({version:1,requestId:'server-id',...i})).join('\n')+'\n');
const withFetch=async(fn)=>{const old=globalThis.fetch;try{await fn();}finally{globalThis.fetch=old;}};
test('all director operations use only the same-origin dedicated service, preserve credentials and return receipt',()=>withFetch(async()=>{
    const calls=[];globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body,headers:options.headers});return frames({type:'result',result:body.operation==='models'?{data:[{id:'b'},{id:'a'},{id:'a'}]}:result});};
    const client=new AuxiliaryApiClient(()=>{throw new Error('must not consult main API');});
    assert.deepEqual(await client.models(profile),['a','b']);
    const response=await client.structured(profile,'test',{type:'object'});
    assert.equal(response.finishReason,'stop');assert.equal(response.usage.output,8);assert.equal(response.requestId,'server-id');
    assert.ok(calls.every(c=>c.url==='/api/plugins/candy-w-director/request'&&c.body.credential==='private-value'&&c.headers['X-CSRF-Token']==='test'));
    assert.equal(calls[1].body.payload.stream,undefined);
}));
test('missing or mismatched direct service cannot silently fall back to main API',()=>withFetch(async()=>{
    for(const [status,code] of [[404,'DIRECT_SERVICE_MISSING'],[409,'TRANSPORT_VERSION_MISMATCH']]) {
        globalThis.fetch=async()=>new Response('',{status});
        await assert.rejects(new AuxiliaryApiClient(()=>({})).structured(profile,'test',{}),e=>e.code===code);
    }
}));
test('transport preserves upstream code and timings; broken downstream frames never become completion',()=>withFetch(async()=>{
    const client=new AuxiliaryApiClient(()=>({}));
    globalThis.fetch=async()=>frames({type:'error',error:{code:'ECONNRESET',message:'连接中断',status:null,timings:{firstByteMs:42}}});
    await assert.rejects(client.structured(profile,'test',{}),e=>e.code==='CONNECTION_RESET'&&e.diagnostic.timings.firstByteMs===42&&e.diagnostic.requestId==='server-id');
    globalThis.fetch=async()=>frames({type:'progress',stage:'receiving'});
    await assert.rejects(client.structured(profile,'test',{}),e=>e.code==='INCOMPLETE_RESPONSE');
}));
test('cancel propagates to fetch and empties owned requests without submitting a result',()=>withFetch(async()=>{
    globalThis.fetch=async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
    const client=new AuxiliaryApiClient(()=>({}));const pending=client.structured(profile,'test',{});client.cancel();
    await assert.rejects(pending,e=>e.name==='AbortError'&&e.code==='CANCELLED');assert.equal(client.requests.size,0);
}));
test('host refuses an unselected director profile while normal main API generation stays native',async()=>{
    const adapter=new SillyTavernAdapter(),identity={characterId:'a',chatId:'b'};
    adapter.currentChatIdentity=()=>identity;adapter.getSettings=()=>({auxiliaryApis:{profiles:[],directorProfileId:''}});
    await assert.rejects(adapter.generateStructured('test',identity,{schema:{}}),/独立直连/);
    const source=await readFile(new URL('../src/host/sillytavern-adapter.js',import.meta.url),'utf8');
    assert.ok(source.includes("generate('normal'"));assert.ok(!source.includes('presetToGeneratePayload'));
});
test('world input includes only native activated entries with their source identity',async()=>{
    const adapter=new SillyTavernAdapter(),identity={characterId:'a',chatId:'b'};
    adapter.currentChatIdentity=()=>identity;adapter.currentContext=()=>({chat:[],maxContext:10000});
    globalThis.__worldScan={allActivatedEntries:new Set([{world:'book',uid:7,comment:'Entry',content:'Known fact',key:['key'],position:1}])};
    const entries=await adapter.collectNativeWorldInfo('key',identity);
    assert.equal(entries[0].origin.uid,7);assert.equal(entries[0].content,'Known fact');assert.equal(entries.length,1);
});
