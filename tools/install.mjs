import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {migrateDirectorSettings,migrateChatEnvelope} from '../src/persistence/director-migration.js';
const [host,baselineFile,backup,mode='inspect']=process.argv.slice(2);
if(!host||!baselineFile||!backup)throw new Error('Usage: node tools/install.mjs HOST BASELINE_HASHES BACKUP [install]');
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url))),target=path.join(host,'data/default-user/extensions/candy-w-rpg-console'),serverTarget=path.join(host,'plugins/candy-w-director');
if(fs.lstatSync(target).isSymbolicLink() || (fs.existsSync(serverTarget)&&fs.lstatSync(serverTarget).isSymbolicLink()))throw new Error('安装目标是符号链接，请先核对真实项目目录。');
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
function walk(root){return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(e.name==='.git'?[]:walk(path.join(root,e.name))):[path.join(root,e.name)]);}
const baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8'));const changed=[];
for(const [file,hash]of Object.entries(baseline)){if(file.startsWith('.git/'))continue;const full=path.join(target,file);if(!fs.existsSync(full)||sha(fs.readFileSync(full))!==hash)changed.push(file);}
for(const file of walk(target)){const key=path.relative(target,file);if(!baseline[key]&&key!=='.DS_Store')changed.push(key);}
if(changed.length)throw new Error(`Installed files changed since audit: ${JSON.stringify(changed)}`);
const settingsFile=path.join(host,'data/default-user/settings.json'),settingsRaw=fs.readFileSync(settingsFile),settings=JSON.parse(settingsRaw),extension=settings.extension_settings['candy-w-rpg-console'];
settings.extension_settings['candy-w-rpg-console']=migrateDirectorSettings(extension);
const writes=[];
for(const file of walk(path.join(host,'data/default-user/chats')).filter(f=>f.endsWith('.jsonl'))){
 const raw=fs.readFileSync(file,'utf8'),end=raw.indexOf('\n'),first=end<0?raw:raw.slice(0,end);let header;try{header=JSON.parse(first);}catch{continue;}
 const envelope=header.chat_metadata?.candy_w_rpg_director_v2;if(!envelope)continue;
 const next=migrateChatEnvelope(envelope);if(JSON.stringify(next)===JSON.stringify(envelope))continue;
 header.chat_metadata.candy_w_rpg_director_v2=next;
 writes.push({file,raw:Buffer.from(raw),value:JSON.stringify(header)+(end<0?'':raw.slice(end))});
}
console.log(JSON.stringify({mode,extensionVersion:JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))).version,scenarios:extension.importedScenarios?.length??0,jobs:extension.authoringJobs?.length??0,chatWrites:writes.length,proxyConfigChanged:false}));
if(mode!=='install')process.exit(0);
if(fs.existsSync(backup))throw new Error('Backup destination already exists');fs.mkdirSync(backup,{recursive:true,mode:0o700});
fs.cpSync(target,path.join(backup,'extension'),{recursive:true});
if(fs.existsSync(serverTarget))fs.cpSync(serverTarget,path.join(backup,'server'),{recursive:true});
fs.writeFileSync(path.join(backup,'settings.json'),settingsRaw,{mode:0o600});
for(const write of writes){const name=sha(write.file)+'.jsonl';fs.writeFileSync(path.join(backup,name),write.raw,{mode:0o600});write.backupName=name;}
const proxyHash=sha(fs.readFileSync(path.join(host,'config.yaml')));
const receipt={host,target,serverTarget,proxyHash,chatFiles:writes.map(({file,backupName})=>({file,backupName})),serverExisted:fs.existsSync(serverTarget),installedAt:new Date().toISOString()};
fs.writeFileSync(path.join(backup,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});
function atomic(file,value){const temp=file+'.candy-upgrade';fs.writeFileSync(temp,value,{mode:0o600});fs.renameSync(temp,file);}
let settingsWritten=false;const chatWritten=[];
try{
 for(const entry of fs.readdirSync(target))if(entry!=='.git')fs.rmSync(path.join(target,entry),{recursive:true,force:true});
 for(const entry of ['src','index.js','manifest.json','style.css','PLAYER_GUIDE.md','docs','package.json','tests','server'])fs.cpSync(path.join(source,entry),path.join(target,entry),{recursive:true});
 fs.cpSync(path.join(source,'server'),serverTarget,{recursive:true});
 if(sha(fs.readFileSync(settingsFile))!==sha(settingsRaw))throw new Error('Settings changed during install');
 atomic(settingsFile,JSON.stringify(settings,null,4));settingsWritten=true;
 for(const write of writes){if(sha(fs.readFileSync(write.file))!==sha(write.raw))throw new Error('Chat changed during install');atomic(write.file,write.value);chatWritten.push(write);}
 if(sha(fs.readFileSync(path.join(host,'config.yaml')))!==proxyHash)throw new Error('Host proxy configuration changed concurrently');
 receipt.extensionHash=sha(JSON.stringify(settings.extension_settings['candy-w-rpg-console']));receipt.installedChatHashes=Object.fromEntries(writes.map(w=>[w.file,sha(w.value)]));receipt.installedHashes=Object.fromEntries(walk(target).map(file=>[path.relative(target,file),sha(fs.readFileSync(file))]));fs.writeFileSync(path.join(backup,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});console.log('Paired installation complete; restart Tavern before using director.');
}catch(error){
 fs.rmSync(target,{recursive:true,force:true});fs.cpSync(path.join(backup,'extension'),target,{recursive:true});
 fs.rmSync(serverTarget,{recursive:true,force:true});if(receipt.serverExisted)fs.cpSync(path.join(backup,'server'),serverTarget,{recursive:true});
 if(settingsWritten&&sha(fs.readFileSync(settingsFile))===sha(JSON.stringify(settings,null,4)))atomic(settingsFile,settingsRaw);for(const write of chatWritten)if(sha(fs.readFileSync(write.file))===sha(write.value))atomic(write.file,write.raw);throw error;
}
