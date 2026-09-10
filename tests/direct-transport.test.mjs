import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DirectTransport, CompletionStream, endpointFor } from '../server/direct-transport.mjs';
const chunk = data => `data: ${JSON.stringify(data)}\n\n`;
const complete = chunk({id:'provider-id',model:'model',choices:[{index:0,delta:{content:'{"ok":true}'},finish_reason:null}]})+chunk({choices:[{index:0,delta:{},finish_reason:'stop'}]})+chunk({choices:[],usage:{completion_tokens:7}})+'data: [DONE]\n\n';
async function serverFor(handler) { const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,url:`http://127.0.0.1:${server.address().port}/v1`}; }
const stop=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
test('stream retains usage, stop and tool arguments across arbitrarily fragmented UTF-8 text',()=>{
    const stream=new CompletionStream();for(const ch of complete)stream.push(ch);const r=stream.finish();assert.equal(r.usage.completion_tokens,7);assert.equal(r.choices[0].finish_reason,'stop');
    const partial=new CompletionStream();partial.push(chunk({choices:[{index:0,delta:{content:'{"ok":true}'},finish_reason:'stop'}]}));assert.throws(()=>partial.finish(),e=>e.code==='INCOMPLETE_RESPONSE');
    const tool=new CompletionStream();tool.push(chunk({choices:[{index:0,delta:{tool_calls:[{index:0,function:{name:'director_result',arguments:'{"a":'}}]},finish_reason:null}]})+chunk({choices:[{index:0,delta:{tool_calls:[{index:0,function:{arguments:'1}'}}]},finish_reason:'tool_calls'}]})+'data: [DONE]\n\n');
    assert.equal(tool.finish().choices[0].message.tool_calls[0].function.arguments,'{"a":1}');
});
test('same target uses explicit direct agent while ordinary HTTP still uses the original global agent',async()=>{
    let globalRequests=0;const original=http.globalAgent, global=new http.Agent();const add=global.addRequest;global.addRequest=function(...args){globalRequests++;return add.apply(this,args);};
    const seen=[];const {server,url}=await serverFor((req,res)=>{seen.push(req.url);res.setHeader('content-type','text/event-stream');res.end(complete);});
    const direct=new DirectTransport();http.globalAgent=global;
    try {
        const out=await direct.request({endpoint:url,operation:'completion',payload:{model:'m',messages:[{role:'user',content:'test'}]}});
        assert.equal(globalRequests,0);assert.equal(out.result.choices[0].finish_reason,'stop');
        await new Promise((resolve,reject)=>http.get(url+'/chat/completions',r=>{r.resume();r.on('end',resolve);}).on('error',reject));
        assert.equal(globalRequests,1);assert.deepEqual(seen,['/v1/chat/completions','/v1/chat/completions']);assert.equal(http.globalAgent,global);
    } finally {http.globalAgent=original;direct.close();global.destroy();await stop(server);}
});
test('redirect does not forward credential; HTTP failure retains status without private body text',async()=>{
    const {server,url}=await serverFor((req,res)=>{if(req.url.startsWith('/redirect')){res.writeHead(302,{location:'/secret'});res.end();}else{res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'invalid_api_key',message:'private-body-secret'}}));}});
    const direct=new DirectTransport();try {
        await assert.rejects(direct.request({endpoint:url.replace('/v1','/redirect'),credential:'secret',operation:'models'}),e=>e.code==='REDIRECT_REJECTED');
        await assert.rejects(direct.request({endpoint:url,operation:'models'}),e=>e.status===401&&e.providerCode==='invalid_api_key'&&!e.message.includes('private-body'));
    }finally{direct.close();await stop(server);}
});
test('idle timeout and caller cancellation stop upstream without returning a partial success',async()=>{
    const {server,url}=await serverFor((_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write(': waiting\n\n');});
    const direct=new DirectTransport({idleMs:30,totalMs:1000});try{
        await assert.rejects(direct.request({endpoint:url,operation:'completion',payload:{}}),e=>e.code==='IDLE_TIMEOUT');
        const abort=new AbortController();const pending=direct.request({endpoint:url,operation:'completion',payload:{}},{signal:abort.signal});abort.abort();
        await assert.rejects(pending,e=>e.code==='CANCELLED');
    }finally{direct.close();await stop(server);}
});
test('endpoint normalization preserves provider prefixes and rejects credential-bearing redirects',()=>{
    assert.equal(endpointFor('https://example.com/api/paas/v4/chat/completions','models').href,'https://example.com/api/paas/v4/models');
    assert.throws(()=>endpointFor('https://user:password@example.com','models'));
});
