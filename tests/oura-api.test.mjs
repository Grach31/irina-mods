import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
const dir=new URL('../supabase/functions/myspace-notifications/',import.meta.url);
const core=stripTypeScriptTypes(fs.readFileSync(new URL('core.ts',dir),'utf8')).replace(/export /g,'');
const index=stripTypeScriptTypes(fs.readFileSync(new URL('index.ts',dir),'utf8')).replace(/^import .*\n/gm,'');
function fixture(owner=true){
 let handler;const urls=[],writes=[];
 const prefs={push_categories:['draft','edit','updates','error','published','oura'],center_categories:['draft','edit','updates','error','published','oura'],quiet_start:1320,quiet_end:480};
 const fetch=async(url,opts={})=>{url=String(url);urls.push(url);let data;
  if(url.endsWith('/auth/v1/user'))data={id:owner?'9983fe8e-9a69-4ed5-b8ec-f8e056c2f280':'someone-else'};
  else if(url.includes('/myspace_notification_preferences')){if(opts.method==='PATCH')writes.push(JSON.parse(opts.body));data=[prefs]}
  else if(url.includes('/myspace_notifications?'))data=[{id:'notice',category:'oura',targets:[{space:'oura',id:'2026-11-14'}]}];
  else if(url.includes('/rpc/ms_notice_config'))data={vapid:{publicKey:'public-only'}};
  else if(url.includes('/myspace_push_subscriptions?'))data=[];
  else throw Error('unmocked URL');
  return new Response(JSON.stringify(data),{status:200});
 };
 vm.runInNewContext(core+'\n'+index,{Deno:{env:{get:n=>n==='SUPABASE_URL'?'https://db.test':'secret-test-key'},serve:fn=>handler=fn},fetch,Response,Request,TextEncoder,TextDecoder,crypto:webcrypto,AbortSignal,URL,Date,atob,console});
 return {prefs,urls,writes,call:async(action,extra={})=>{const r=await handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer eyJ.test.token'},body:JSON.stringify({action,...extra})}));return {status:r.status,data:await r.json()}}};
}
test('authenticated center includes Oura notices and correct category filter',async()=>{
 const f=fixture();const r=await f.call('list');assert.equal(r.status,200);assert.equal(r.data.items[0].category,'oura');assert(f.urls.some(u=>u.includes('category=in.(draft,edit,updates,error,published,oura)')));
});
test('all six category choices save without losing Oura or quiet hours',async()=>{
 const f=fixture();const r=await f.call('preferences',{values:f.prefs});assert.equal(r.status,200);assert.deepEqual(f.writes,[f.prefs]);assert.equal(r.data.public_key,'public-only');
});
test('another signed-in user cannot read ring notification history',async()=>{
 const f=fixture(false);assert.equal((await f.call('list')).status,401);assert.equal(f.urls.length,1);
});
