import test from 'node:test';
import assert from 'node:assert/strict';
import { FOG_HARBOR_SCENARIO as scenario } from '../src/scenarios/index.js';
import { createDirectorState,prepareOpeningTurn,prepareActionTurn,createCheckResult,prepareCheckConsequence,commitTurn,validateDirectorState,stateMatchesScenario,preparePublicTurnContent,recoverPendingState,previewPlayerTurn } from '../src/domain/director-state.js';
import { createProgression,progressionFacts } from '../src/domain/player-progression.js';
import { resolveSkillCheck,skillCheck,validSkillCheck } from '../src/domain/skill-check.js';
import { buildPerformanceDirective } from '../src/protocol/performance.js';
import { generatedPlayer } from './support/player-fixture.mjs';
import { validateGeneratedPlayer } from '../src/protocol/player-generation.js';
const done = prepared => commitTurn(prepared.state,scenario,prepared.turn,{performance:'同伴陪你继续前行，接下来由你决定。'});
function playing(value=35) {
 const entries=generatedPlayer().entries;entries[1].value=value;
 const state=createDirectorState(scenario,{name:'旅人',concept:'',relationship:'',attributes:{body:0,insight:0,rapport:0},progression:createProgression(entries)});
 return done(prepareOpeningTurn(state,scenario));
}
const decision = (state,extra={}) => ({transactionId:'tx_skill',baseRevision:state.revision,actionId:'gate_to_pump',attribute:null,summary:'使用火球术照明后前往泵房',ruleIds:['p_success','p_failure'],skillId:'p_fire',...extra});
function directive(p){return buildPerformanceDirective({publicFacts:[],mustHappen:p.turn.decision.mustHappen,forbiddenTopics:[],check:p.turn.decision.check,playerState:previewPlayerTurn(p.state,p.turn).facts});}

test('skill percentile boundaries are inclusive, zero never triggers, and mastery never draws randomness',()=>{
 const entry=generatedPlayer().entries[1],move=scenario.scenes[0].moves[0];
 for(const [value,random,expected] of [[35,.349,'success'],[35,.35,'failure'],[0,0,'failure'],[99,.989,'success'],[99,.999,'failure']]){
  const check=skillCheck({...entry,value},move);const resolved=resolveSkillCheck(check,()=>random);
  assert.equal(resolved.roll.outcome,expected);assert.equal(validSkillCheck(resolved),true);
 }
 const mastered=resolveSkillCheck(skillCheck({...entry,value:100},move),()=>{throw Error('must not draw');});
 assert.deepEqual(mastered.roll,{dice:[],modifier:0,total:0,outcome:'success'});
});
test('skill attempt cannot advance a non-check move or disclose its facts before the die; failure stays in place',()=>{
 const original=playing();const attempt=prepareActionTurn(original,scenario,decision(original));
 assert.equal(attempt.turn.decision.nextSceneId,null);assert.deepEqual(attempt.turn.decision.hiddenPatch.occurredFactIds,[]);
 const preview=preparePublicTurnContent(attempt.state,scenario,attempt.turn);assert.equal(preview.evidence[0].title,original.public.scene.title);
 const waiting=done(attempt);assert.equal(waiting.phase,'awaiting_check');assert.equal(waiting.hidden.currentSceneId,original.hidden.currentSceneId);
 assert.equal(stateMatchesScenario(waiting,scenario),true);assert.match(directive(attempt),/d100/);
 const result=createCheckResult(waiting,scenario,{checkId:waiting.public.pendingCheck.id},{random:()=>.99});
 const consequence=prepareCheckConsequence(waiting,scenario,result);assert.match(directive(consequence),/未触发/);
 assert.deepEqual(recoverPendingState(consequence.state),consequence.state);
 const failed=done(consequence);assert.equal(failed.hidden.currentSceneId,original.hidden.currentSceneId);assert.equal(failed.player.progression.entries[1].value,36);
 assert.throws(()=>createCheckResult(failed,scenario,{checkId:result.checkId}),/等待/);
});
test('successful skill triggers the intended move, commits growth once, and mastery completes in the same turn',()=>{
 for(const value of [35,100]){
  const original=playing(value),attempt=prepareActionTurn(original,scenario,decision(original));
  let result;
  if(value===100){assert.equal(attempt.turn.decision.check.status,'resolved');assert.match(directive(attempt),/没有投骰/);result=done(attempt);}
  else {const waiting=done(attempt);const roll=createCheckResult(waiting,scenario,{checkId:waiting.public.pendingCheck.id},{random:()=>.1});result=done(prepareCheckConsequence(waiting,scenario,roll));}
  assert.equal(result.hidden.currentSceneId,'old_pump');assert.equal(result.player.progression.entries[1].value,Math.min(100,value+3));assert.equal(result.player.progression.deferred.length,0);assert.ok(validateDirectorState(result));assert.ok(stateMatchesScenario(result,scenario));
 }
});
test('skill use preserves existing authored check branches and rejects tampered or unavailable skills',()=>{
 let original=playing();original=done(prepareActionTurn(original,scenario,decision(original,{actionId:'gate_to_office',skillId:null,ruleIds:[]})));
 const attempt=prepareActionTurn(original,scenario,decision(original,{actionId:'office_search_check',attribute:'insight'}));
 const waiting=done(attempt);const rolled=createCheckResult(waiting,scenario,{checkId:waiting.public.pendingCheck.id},{random:()=>.1});
 assert.equal(rolled.consequenceMoveId,'archives_success');assert.throws(()=>prepareCheckConsequence(waiting,scenario,{...rolled,total:99}),/无效/);
 const next=done(prepareCheckConsequence(waiting,scenario,rolled));assert.ok(next.hidden.occurredFacts.includes('attempted_archives'));assert.ok(stateMatchesScenario(next,scenario));
 for(const entry of [{learned:false},{enabled:false}]){const state=playing();Object.assign(state.player.progression.entries[1],entry);assert.throws(()=>prepareActionTurn(state,scenario,decision(state)),/未学会|停用/);}
});
test('generated entries are complete, validate arithmetic and keep maximum length effects inside performance budget',()=>{
 const value=generatedPlayer();assert.equal(validateGeneratedPlayer(value),value);
 const wrong=structuredClone(value);wrong.entries[1].value=101;assert.throws(()=>validateGeneratedPlayer(wrong));
 const duplicate=structuredClone(value);duplicate.entries[1].rules[0].id='p_run';assert.throws(()=>validateGeneratedPlayer(duplicate),/重复/);
 value.entries[1].effect='效'.repeat(240);value.entries[1].condition='条'.repeat(200);
 const facts=progressionFacts(createProgression(value.entries));assert.ok(facts.every(s=>s.length<=500));assert.doesNotThrow(()=>buildPerformanceDirective({publicFacts:[],mustHappen:['演出'],forbiddenTopics:[],check:null,playerState:facts}));
});
