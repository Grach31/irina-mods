import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../miniapp/index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('async function fetchPublicModa('),html.indexOf('function resetModa('));
function fixture({session='session',space='moda',owner=false,privateRows=[],privateFailure=false}={}){
 const old=[{id:'old',meta:{status:'queued'}}];
 const next=[{id:'old',meta:{status:'queued'}},{id:'new',meta:{status:'queued'}}];
 const elements={list:{innerHTML:'existing'},pending:{textContent:'1'},published:{textContent:'0'},rejected:{textContent:'0'}};
 let resolve,reject,publicCalls=0,storageCalls=0;
 const response=new Promise((a,b)=>{resolve=a;reject=b});
 const c={items:old,modaRequest:null,publicModa:old,privateModa:[],publicAt:1,privateAt:0,privateModaError:false,modaDecisionVersion:0,
  pwaSession:session,isTelegramClient:false,currentSpace:space,authScope:new AbortController(),Date,
  needsPrivate:()=>owner&&c.currentSpace==='moda',mayReadPrivate:()=>owner,privateReader:{async load(){
   storageCalls++;if(privateFailure)throw Error('offline');return privateRows;
  }},$:id=>elements[id],readJson:async()=>{publicCalls++;return {items:next}},
  publishApi:()=>response,reconcileModaDetail:()=>{},privateImages:new Map()};
 c.render=()=>{for(const key of ['pending','published','rejected'])
  elements[key].textContent=String(c.items.filter(x=>x.meta.status===(key==='pending'?'queued':key)).length)};
 vm.createContext(c);vm.runInContext(code,c);
 return {c,old,elements,resolve,reject,calls:()=>[publicCalls,storageCalls]};
}
test('Refresh keeps the previous counters until the authoritative moderation result arrives',async()=>{
 const {c,old,elements,resolve,calls}=fixture();
 const pending=c.load({refresh:true});
 assert.equal(c.load({refresh:true}),pending);assert.deepEqual(calls(),[1,0]);
 assert.equal(c.items,old);assert.equal(elements.pending.textContent,'1');
 resolve({items:[{draft_id:'old',status:'published'},{draft_id:'new',status:'rejected'}]});
 assert.equal(await pending,true);assert.equal(elements.pending.textContent,'0');
 assert.equal(elements.published.textContent,'1');assert.equal(elements.rejected.textContent,'1');
});
test('Failed moderation sync preserves the confirmed catalog and counters',async()=>{
 const {c,old,elements,reject}=fixture();
 const pending=c.load();reject(Error('offline'));
 assert.equal(await pending,false);assert.equal(c.items[0],old[0]);assert.equal(elements.pending.textContent,'1');
 assert.equal(elements.published.textContent,'0');assert.equal(elements.rejected.textContent,'0');
});
test('Boot and the Hub cannot start Moda or expose raw counters',async()=>{
 for(const config of [{session:''},{space:'hub',owner:true}]){
  const {c,old,calls}=fixture(config);
  assert.equal(await c.load({refresh:true}),false);assert.equal(c.items,old);assert.deepEqual(calls(),[0,0]);
 }
});
test('Owner loads private rows on demand and does not create a second row for any draft ID',async()=>{
 const row={id:'private-1',meta:{status:'queued'},privatePreview:true};
 const {c,resolve,calls}=fixture({owner:true,privateRows:[row,row,{...row,id:'old'}]});
 const pending=c.load();resolve({items:[]});assert.equal(await pending,true);
 assert.equal(c.items.filter(x=>x.id==='private-1').length,1);
 assert.equal(c.items.filter(x=>x.id==='old').length,1);assert.equal(c.privateModaError,false);
 assert.equal(await c.load(),true);assert.deepEqual(calls(),[1,1]);
});
test('Failed private refresh preserves private rows and reports the failure to pull-to-refresh',async()=>{
 const row={id:'private-1',meta:{status:'queued'},privatePreview:true};
 const {c,resolve}=fixture({owner:true,privateFailure:true});c.privateModa=[row];c.items=[...c.items,row];
 const pending=c.load();resolve({items:[]});assert.equal(await pending,false);
 assert.equal(c.items.filter(x=>x.id==='private-1').length,1);assert.equal(c.privateModaError,true);
});
test('Logout ignores a late authoritative response',async()=>{
 const {c,old,resolve}=fixture();const pending=c.load();c.authScope.abort();resolve({items:[]});
 assert.equal(await pending,false);assert.equal(c.items,old);
});
