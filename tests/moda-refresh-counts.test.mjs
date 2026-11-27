import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../miniapp/index.html',import.meta.url),'utf8');
const start=html.indexOf('function load({refresh=false}={})');
const end=html.indexOf('function current()',start);
assert(start>=0&&end>start);
const code=html.slice(start,end);
function fixture({session='session',telegram=false,owner=false,privateRows=[],privateFailure=false}={}){
 const old=[{id:'old',meta:{status:'queued'}}];
 const next=[{id:'old',meta:{status:'queued'}},{id:'new',meta:{status:'queued'}}];
 const elements={list:{innerHTML:'existing'},pending:{textContent:'1'},published:{textContent:'0'},rejected:{textContent:'0'}};
 let resolve,reject;
 const response=new Promise((a,b)=>{resolve=a;reject=b});
 const c={items:old,loading:null,lastLoaded:0,pwaSession:session,isTelegramClient:telegram,readonly:!owner,privateModaView:null,privateModaUrls:[],privateModaError:false,active:null,URL,authClient:async()=>({}),privateModaModule:async()=>({loadPrivate:async()=>{if(privateFailure)throw Error('offline');return privateRows},release(){}}),console:{warn(){}},Date,
 $:id=>elements[id],fetchCatalog:async()=>({items:next,pending:30,published:0,rejected:0}),
 publishApi:()=>response};
 c.render=()=>{elements.pending.textContent=String(c.items.filter(x=>x.meta.status==='queued').length);elements.published.textContent=String(c.items.filter(x=>x.meta.status==='published').length);elements.rejected.textContent=String(c.items.filter(x=>x.meta.status==='rejected').length)};
 vm.createContext(c);vm.runInContext(code,c);
 return {c,old,next,elements,resolve,reject};
}
test('Moda keeps old counters and draft list until moderation statuses arrive',async()=>{
 const {c,old,next,elements,resolve}=fixture();
 const pending=c.load({refresh:true});await Promise.resolve();await Promise.resolve();
 assert.equal(c.items,old);assert.equal(elements.pending.textContent,'1');assert.equal(elements.published.textContent,'0');assert.equal(elements.rejected.textContent,'0');
 resolve({items:[{draft_id:'old',status:'published'},{draft_id:'new',status:'rejected'}]});
 assert.equal(await pending,true);assert.equal(c.items,next);assert.equal(elements.pending.textContent,'0');assert.equal(elements.published.textContent,'1');assert.equal(elements.rejected.textContent,'1');
});
test('Moda retains confirmed snapshot on Supabase failure',async()=>{
 const {c,old,elements,reject}=fixture();
 const pending=c.load();await Promise.resolve();await Promise.resolve();reject(Error('offline'));
 assert.equal(await pending,false);assert.equal(c.items,old);assert.equal(elements.pending.textContent,'1');assert.equal(elements.published.textContent,'0');assert.equal(elements.rejected.textContent,'0');
});
test('Safari does not expose raw catalog counters before session restoration',async()=>{
 const {c,old,elements}=fixture({session:''});
 assert.equal(await c.load(),false);assert.equal(c.items,old);assert.equal(elements.pending.textContent,'1');
});

test('owner loads and deduplicates private cards even with older module lacking merge helper',async()=>{const row={id:'private-1',meta:{status:'queued'},privatePreview:true,privateUrls:[]};const {c,resolve}=fixture({owner:true,privateRows:[row,row]});const pending=c.load();resolve({items:[]});assert.equal(await pending,true);assert.equal(c.items.filter(x=>x.id==='private-1').length,1);assert.equal(c.privateModaError,false)});
test('failed private refresh preserves the previous private snapshot and reports failure',async()=>{const row={id:'private-1',meta:{status:'queued'},privatePreview:true,privateUrls:[]};const {c,resolve}=fixture({owner:true,privateFailure:true});c.privateModaUrls=[row];c.items=[...c.items,row];const pending=c.load();resolve({items:[]});assert.equal(await pending,true);assert.equal(c.items.filter(x=>x.id==='private-1').length,1);assert.equal(c.privateModaError,true)});
