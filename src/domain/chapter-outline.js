import {assertContract,object,list,text,identifier} from './json-contract.js';
export function validateChapterOutline(value){
 assertContract(value,list(object({id:identifier,title:text(120,0),summary:text(600,0)}),64),'章节大纲');
 if(new Set(value.map(c=>c.id)).size!==value.length)throw new Error('章节编号不能重复。');
 return structuredClone(value);
}
