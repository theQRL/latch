import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { requireEmpty } from "../shared/src/lib/lifecycle-db.js";
const source = readFileSync(new URL("../apps/pwa/sw.js",import.meta.url),"utf8").replace(/^import[\s\S]*?;\n/,"");
function harness({old=false,state=null,fail=false}={}) {
  const handlers={}, stores=new Map(), fetched=[];let record=state, skipped=false;
  const cacheFor = name => {
    if(!stores.has(name)) stores.set(name,new Map());const entries=stores.get(name);
    return {match:async k=>entries.get(String(k))?.clone(),put:async(k,v)=>entries.set(String(k),v)};
  };
  if(old) stores.set('latch-shell-old',new Map([['/__latch-installed__',new Response('installed')]]));
  const self={__WB_MANIFEST:[{url:'index.html'},{url:'icon.png'},{url:'icon.png'}],__LATCH_DIGESTS__:{'index.html':'sha256-test','icon.png':'sha256-test'},location:{origin:'https://latch.example'},clients:{claim:async()=>{},get:async()=>({url:'https://latch.example/'}),matchAll:async()=>[{}]},skipWaiting:async()=>{skipped=true;},addEventListener:(n,f)=>(handlers[n]??=[]).push(f)};
  vm.runInNewContext(source,{self,__BUILD_ID__:'fixture',transactRecord:async change=>change?(record=change(structuredClone(record))):structuredClone(record),requireEmpty,caches:{open:async name=>cacheFor(name),keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name)},fetch:async request=>{fetched.push(request);if(fail)throw Error('Network failed');return new Response('file bytes');},Request,Response,URL,Set,Error,AbortController,setTimeout,clearTimeout});
  return {self,stores,fetched,get state(){return record;},get skipped(){return skipped;}, async event(name,data={}) { const tasks=[];let response; for(const fn of handlers[name]||[])fn({...data,waitUntil:p=>tasks.push(p),respondWith:p=>{response=p;}});await Promise.all(tasks);return response;}};
}
test('initial installation verifies each unique resource and marks complete',async()=>{
 const h=harness();await h.event('install');assert.equal(h.fetched.length,2);assert.equal(h.fetched[0].integrity,'sha256-test');assert.ok(h.stores.get('latch-shell-fixture').has('/__latch-installed__'));
});
test('sealed installations and unapproved releases cannot replace existing code',async()=>{
 for(const state of [null,{phase:'sealed',values:{}},{phase:'downloading',target:'wrong',values:{}},{phase:'downloading',target:'fixture',values:{vault:'secret'}}]) {
  const h=harness({old:true,state});await assert.rejects(h.event('install'));assert.equal(h.fetched.length,0);
 }
});
test('approved empty update stages files before activation and retains old cache',async()=>{
 const h=harness({old:true,state:{phase:'downloading',target:'fixture',epoch:'1',values:{}}});
 await h.event('install');assert.equal(h.skipped,true);assert.equal(h.state.phase,'downloading');assert.ok(h.stores.has('latch-shell-old'));
 await h.event('activate');assert.equal(h.state.phase,'maintenance');assert.equal(h.state.installedBuild,'fixture');
});
test('interrupted download removes only candidate cache and leaves retry state',async()=>{
 const h=harness({old:true,fail:true,state:{phase:'downloading',target:'fixture',values:{}}});await assert.rejects(h.event('install'),/Network failed/);assert.ok(h.stores.has('latch-shell-old'));assert.equal(h.stores.has('latch-shell-fixture'),false);assert.equal(h.state.phase,'downloading');assert.equal(h.skipped,false);
});
test('cache-only fetch denies missing and cross-origin content',async()=>{
 const h=harness();for(const url of ['https://latch.example/api','https://outside.example/']) {const response=await h.event('fetch',{request:{url,method:'GET',mode:'cors'}});assert.ok(response.status===503||response.type==='error');}assert.equal(h.fetched.length,0);
});
test('cache inspection requires all assets plus install marker',async()=>{
 const h=harness();await h.event('install');let result;
 const inspect=async()=>{await h.event('message',{data:{type:'LATCH_CHECK_CACHE'},ports:[{postMessage:v=>result=v}]});return result;};
 assert.equal((await inspect()).complete,true);assert.equal(result.total,2);
 h.stores.get('latch-shell-fixture').set('icon.png',new Response(''));assert.equal((await inspect()).complete,false);
});
test('release checks never fetch while sealed or cleanup is incomplete',async()=>{
 for(const phase of ['sealed','wiping','downloading']) {const h=harness({state:{phase,values:{}}});let result;await h.event('message',{source:{id:'tab'},data:{type:'LATCH_RELEASE_CHECK'},ports:[{postMessage:v=>result=v}]});assert.ok(result.error);assert.equal(h.fetched.length,0);}
});
