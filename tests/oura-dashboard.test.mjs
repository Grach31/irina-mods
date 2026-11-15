import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

const source=stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/oura-dashboard/index.ts',import.meta.url),'utf8'));
const encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function assertion(claims={}){
 const now=Math.floor(Date.now()/1000);
 return [encoded({alg:'RS256',kid:'test-key'}),encoded({
  iss:'https://token.actions.githubusercontent.com',aud:'stambo-oura-dashboard',
  repository:'Grach31/oura',ref:'refs/heads/main',event_name:'push',
  workflow_ref:'Grach31/oura/.github/workflows/oura.yml@refs/heads/main',iat:now,exp:now+300,...claims,
 }),'c2lnbmF0dXJl'].join('.');
}
const syncConfig={client_id:'private-client',client_secret:'private-client-secret',
 access_token:'private-access',refresh_token:'private-refresh',expires_at:'2026-12-01T00:00:00Z'};
const metrics={sleep:{score:84,detail:{day:'2026-11-15',total_seconds:27000}},
 readiness:{score:89},activity:{score:80,day:'2026-11-14',steps:6000},history:[]};
function fixture({configured=false,configureResult=true,configureHttp=200,signatureValid=true}={}){
 let handler;const calls=[];
 const stored={...metrics,bot_id:'8827004851'};
 const fetch=async(url,options={})=>{
  url=String(url);const body=options.body?JSON.parse(options.body):null;calls.push({url,options,body});
  if(url.includes('/.well-known/jwks'))return Response.json({keys:[{kid:'test-key',kty:'RSA'}]});
  if(url.endsWith('/rpc/ms_oura_sync_request'))return Response.json({configured});
  if(url.endsWith('/rpc/ms_oura_sync_configure'))return Response.json(configureResult,{status:configureHttp});
  if(url.includes('/stambo_oura_snapshot'))return options.method==='GET'
   ?Response.json([{payload:stored,updated_at:'2026-11-15T07:00:00Z'}])
   :new Response(null,{status:201});
  throw Error('unmocked_url');
 };
 vm.runInNewContext(source,{Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://database.test':'service-only-key'},serve:fn=>handler=fn},
  crypto:{subtle:{importKey:async()=>({}),verify:async()=>signatureValid}},
  fetch,Response,Request,TextEncoder,TextDecoder,AbortSignal,URLSearchParams,Date,atob,
 });
 return {calls,call:async(body,{token=assertion()}={})=>{
  const response=await handler(new Request('https://edge.test',{method:'POST',
   headers:token?{Authorization:'Bearer '+token}:{},body:JSON.stringify(body)}));
  return {status:response.status,data:await response.json()};
 }};
}

test('unauthorized bootstrap and status cannot read or write the database',async()=>{
 for(const action of ['ingest','sync_status']){
  for(const token of ['',assertion({repository:'other/repository'}),assertion({exp:1})]){
   const f=fixture();const response=await f.call({action,data:metrics,sync_config:syncConfig},{token});
   assert.equal(response.status,401);
   assert.deepEqual(response.data,{error:'github_oidc_unauthorized'});
   assert.equal(f.calls.length,0);
  }
  const badSignature=fixture({signatureValid:false});
  assert.equal((await badSignature.call({action})).status,401);
  assert.equal(badSignature.calls.filter(c=>c.url.includes('database.test')).length,0);
 }
});

test('signed workflow status reports only whether the scheduler owns synchronization',async()=>{
 for(const configured of [false,true]){
  const f=fixture({configured});
  assert.deepEqual(await f.call({action:'sync_status'}),{status:200,data:{ok:true,scheduler_configured:configured}});
  assert.equal(f.calls.filter(c=>c.url.includes('database.test')).length,1);
  assert(f.calls.at(-1).url.endsWith('/rpc/ms_oura_sync_request'));
 }
});

test('a late GitHub ingest cannot overwrite server-owned data or credentials',async()=>{
 const f=fixture({configured:true});
 assert.deepEqual(await f.call({action:'ingest',data:{old:'data'},sync_config:{invalid:true}}),{
  status:200,data:{ok:true,scheduler_configured:true},
 });
 assert.equal(f.calls.filter(c=>c.url.includes('database.test')).length,1);
 assert(f.calls.at(-1).url.endsWith('/rpc/ms_oura_sync_request'));
});

test('initial handoff stores only approved config keys separately from sanitized metrics',async()=>{
 const f=fixture();
 const result=await f.call({action:'ingest',bot_id:'8827004851',
  data:{...metrics,client_secret:'accidental-private-value',sleep:{...metrics.sleep,score:900}},
  sync_config:{...syncConfig,extra_secret:'must-not-be-persisted'},
 });
 assert.deepEqual(result,{status:200,data:{ok:true,scheduler_configured:true}});
 const snapshot=f.calls.find(c=>c.url.includes('/stambo_oura_snapshot'));
 assert.equal(snapshot.body.id,1);
 assert.equal(snapshot.body.payload.sleep.score,null);
 assert.deepEqual(Object.keys(snapshot.body.payload).sort(),['activity','bot_id','cycle','history','readiness','sleep']);
 const snapshotText=JSON.stringify(snapshot.body);
 for(const value of Object.values(syncConfig))assert(!snapshotText.includes(value));
 assert(!snapshotText.includes('accidental-private-value'));
 const configure=f.calls.find(c=>c.url.endsWith('/rpc/ms_oura_sync_configure'));
 assert.deepEqual(configure.body,{p_config:syncConfig});
 assert.equal(configure.options.headers.Authorization,'Bearer service-only-key');
});

test('failed provisioning never returns scheduler success or private failure details',async()=>{
 for(const failure of [{configureResult:false},{configureHttp:503}]){
  const f=fixture(failure);const result=await f.call({action:'ingest',data:metrics,bot_id:'8827004851',sync_config:syncConfig});
  assert(result.status>=500);
  assert.equal(result.data.scheduler_configured,undefined);
  assert.equal(result.data.ok,undefined);
  assert(!JSON.stringify(result).includes('private-'));
 }
});

test('Telegram read still requires a valid signature and the permitted owner',async()=>{
 const initData=id=>new URLSearchParams({signature:'c2lnbmF0dXJl',
  auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id})}).toString();
 const unauthorized=fixture();
 assert.equal((await unauthorized.call({action:'read',initData:initData('999999999')})).status,403);
 const forged=fixture({signatureValid:false});
 assert.equal((await forged.call({action:'read',initData:initData('880098519')})).status,403);
 const owner=fixture();const result=await owner.call({action:'read',initData:initData('880098519')});
 assert.equal(result.status,200);
 assert.equal(result.data.sleep.score,84);
 assert.equal(result.data.bot_id,undefined);
 assert.equal(result.data.updated_at,'2026-11-15T07:00:00Z');
 assert(owner.calls.every(c=>!c.url.includes('/rpc/')));
});
