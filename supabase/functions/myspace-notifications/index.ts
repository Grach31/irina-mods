import webpush from 'npm:web-push@3.6.7';
import {validSubscription,safeTarget,groupJobs,notificationPayload,CATEGORIES} from './core.ts';
const URL_BASE=Deno.env.get('SUPABASE_URL')!;
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OWNER='9983fe8e-9a69-4ed5-b8ec-f8e056c2f280';
const SITE='https://grach31.github.io/irina-mods/';
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'https://grach31.github.io','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
const out=(v:unknown,status=200)=>new Response(status===204?null:JSON.stringify(v),{status,headers});
async function db(path:string,method='GET',data?:unknown){const r=await fetch(URL_BASE+'/rest/v1/'+path,{method,headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',Prefer:'return=representation,resolution=merge-duplicates'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('database_'+r.status);return r.status===204?null:r.json()}
const rpc=(name:string,args:unknown={})=>db('rpc/'+name,'POST',args);
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
async function identity(token:string){if(token.length>12000||!token.startsWith('eyJ'))return null;const r=await fetch(URL_BASE+'/auth/v1/user',{headers:{apikey:KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(6000)});if(!r.ok)return null;const u=await r.json();return u.id===OWNER?u.id:null}
function decode(s:string){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),x=>x.charCodeAt(0))}
async function githubIdentity(token:string){try{const parts=token.split('.');if(parts.length!==3)return false;const h=JSON.parse(new TextDecoder().decode(decode(parts[0]))),p=JSON.parse(new TextDecoder().decode(decode(parts[1]))),now=Date.now()/1000;
 if(h.alg!=='RS256'||!h.kid||p.iss!=='https://token.actions.githubusercontent.com'||p.aud!=='myspace-notifications'||p.repository!=='Grach31/irina-mods'||p.ref!=='refs/heads/main'||p.workflow_ref!=='Grach31/irina-mods/.github/workflows/miniapp-pages.yml@refs/heads/main'||p.exp<now||p.iat>now+60||p.iat<now-600)return false;
 const jwks=await fetch('https://token.actions.githubusercontent.com/.well-known/jwks',{signal:AbortSignal.timeout(6000)}).then(r=>r.json());const jwk=jwks.keys.find((x:any)=>x.kid===h.kid);if(!jwk)return false;const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);return crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));}catch{return false}}
async function reconcile(){
 const fetchJSON=async(path:string)=>{const r=await fetch(SITE+path+'?notice='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('release_unavailable');const text=await r.text();return {text,data:JSON.parse(text)}};
 const {data:m}=await fetchJSON('notification-manifest.json');
 if(!m||!Array.isArray(m.items)||m.items.length>1000||!/^[a-f0-9]{40}$/.test(m.sha))throw Error('invalid_release');
 // Verify deployment is coherent; reject manifest/content skew before recording readiness.
 for(const [file,expected] of Object.entries(m.files||{})){
 if(!['catalog.json','fashion-daily.json','reels-studio.json','style-time-machine.json','trend-radar.json'].includes(file))throw Error('invalid_source');
 const v=await fetchJSON(file);if(await hash(v.text)!==expected)throw Error('release_not_coherent');
 }
 if(Object.keys(m.files||{}).length!==5||m.items.some((x:any)=>!safeTarget(x.target)||!['draft','updates'].includes(x.kind)||!/^[a-f0-9]{64}$/.test(x.version)))throw Error('invalid_inventory');
 const result=await rpc('ms_notice_ingest',{p_manifest:m});
 if(!result.baseline)await rpc('ms_notice_editorial',{p_reports:m.reports||[]});
 return result;
}
async function worker(config:any,reconcileNow:boolean){
 let ingested:any=null;
 if(reconcileNow||!config.last_reconcile||Date.now()-Date.parse(config.last_reconcile)>3600000){
 try{ingested=await reconcile();await rpc('ms_notice_cleanup')}catch(e){const code=e instanceof Error&&/^[a-z_]+(?:_\d{3})?$/.test(e.message)?e.message:'fetch_failed';await db('rpc/ms_notice_health','POST',{p_error:'release_reconcile_failed:'+code});}
 }
 await rpc('ms_notice_oura');
 const jobs=await rpc('ms_notice_claim');let accepted=0;
 for(const group of groupJobs(jobs)){
 const uid=group[0].notification.user_id;
 const unread=(await db('myspace_notifications?user_id=eq.'+uid+'&read_at=is.null&select=id')).length;
 let status=0,retry=60;
 try{const r=await webpush.sendNotification(group[0].subscription,JSON.stringify(notificationPayload(group,unread)),{TTL:3600,urgency:'normal',timeout:10000,vapidDetails:{subject:'https://grach31.github.io/irina-mods/',publicKey:config.vapid.publicKey,privateKey:config.vapid.privateKey}});status=r.statusCode;accepted+=group.length;
 }catch(e:any){status=Number(e.statusCode)||0;const value=Number(e.headers?.['retry-after']);if(Number.isFinite(value))retry=Math.min(86400,Math.max(60,value));}
 await rpc('ms_notice_finish',{p_ids:group.map(x=>x.id),p_leases:group.map(x=>x.lease),p_status:status,p_retry:retry});
 }
 return {ok:true,ingested,processed:jobs.length,accepted};
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return out({},204);if(req.method!=='POST')return out({error:'method_not_allowed'},405);
 try{
 if(Number(req.headers.get('content-length')||0)>20000)return out({error:'too_large'},413);
 const raw=await req.text();if(raw.length>20000)return out({error:'too_large'},413);const b=JSON.parse(raw),action=String(b.action||'');
 const token=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');
 if(action==='worker'||action==='deployment'||action==='deployment_error'){
 let config=await rpc('ms_notice_config');
 const cronAuthorized=token.length===64&&token===config.worker_token;
 if(!cronAuthorized&&!await githubIdentity(token))return out({error:'unauthorized'},401);
 if(!config.enabled)return out({ok:true,disabled:true});
 if(action==='deployment_error'){if(!/^[a-f0-9]{40}$/.test(b.sha||''))return out({error:'invalid_release'},400);await rpc('ms_notice_build_error',{p_sha:b.sha});return out({ok:true});}
 if(!config.vapid)config=await rpc('ms_notice_config',{p_vapid:webpush.generateVAPIDKeys()});
 return out(await worker(config,action==='deployment'));
 }
 const uid=await identity(token);if(!uid)return out({error:'unauthorized'},401);
 if(!(await db('myspace_notification_preferences?user_id=eq.'+uid+'&select=user_id')).length)await db('myspace_notification_preferences','POST',{user_id:uid});
 const own='user_id=eq.'+uid;
 if(action==='count'){
 const prefs=(await db('myspace_notification_preferences?'+own))[0];
 const rows=await db('myspace_notifications?'+own+'&read_at=is.null&select=id,category');return out({unread:rows.filter((x:any)=>prefs.center_categories.includes(x.category)).length});
 }
 if(action==='list'){
 const prefs=(await db('myspace_notification_preferences?'+own))[0];
 const cats=prefs.center_categories.filter((x:string)=>CATEGORIES.includes(x));
 let path='myspace_notifications?'+own+'&category=in.('+cats.join(',')+')&order=created_at.desc,id.desc&limit=31';
 if(b.unread)path+='&read_at=is.null';
 if(b.cursor){const date=String(b.cursor.at),id=String(b.cursor.id);if(!/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|\+00:00)$/.test(date)||!/^[-a-f0-9]{36}$/.test(id))return out({error:'invalid_cursor'},400);path+='&or=(created_at.lt.'+encodeURIComponent(date)+',and(created_at.eq.'+encodeURIComponent(date)+',id.lt.'+id+'))';}
 const rows=cats.length?await db(path):[],more=rows.length>30;return out({items:rows.slice(0,30),more,prefs,server_time:new Date().toISOString()});
 }
 if(action==='get'){
 if(!/^[a-f0-9-]{36}$/.test(b.id||''))return out({error:'invalid_id'},400);
 const rows=await db('myspace_notifications?'+own+'&id=eq.'+b.id);return out({item:rows[0]||null});
 }
 if(action==='read'||action==='read_all'){
 let q='myspace_notifications?'+own+'&read_at=is.null';
 if(action==='read'){if(!/^[a-f0-9-]{36}$/.test(b.id||''))return out({error:'invalid_id'},400);q+='&id=eq.'+b.id;}
 else {const before=Date.parse(b.before);if(!Number.isFinite(before)||before>Date.now()+60000)return out({error:'invalid_cutoff'},400);q+='&created_at=lte.'+encodeURIComponent(new Date(before).toISOString());}
 await db(q,'PATCH',{read_at:new Date().toISOString()});
 if(Array.isArray(b.delivery_ids)&&b.delivery_ids.length<51){const ids=b.delivery_ids.filter((x:string)=>/^[a-f0-9-]{36}$/.test(x));if(ids.length){const ownSubs=await db('myspace_push_subscriptions?'+own+'&select=id');if(ownSubs.length)await db('myspace_push_deliveries?id=in.('+ids.join(',')+')&subscription_id=in.('+ownSubs.map((x:any)=>x.id).join(',')+')','PATCH',{opened_at:new Date().toISOString()});}}
 return out({ok:true});
 }
 if(action==='preferences'){
 if(b.values){const v=b.values;const valid=(a:any)=>Array.isArray(a)&&a.length<=CATEGORIES.length&&new Set(a).size===a.length&&a.every((x:any)=>CATEGORIES.includes(x));if(!valid(v.push_categories)||!valid(v.center_categories)||![v.quiet_start,v.quiet_end].every((x:any)=>Number.isInteger(x)&&x>=0&&x<=1439))return out({error:'invalid_preferences'},400);await db('myspace_notification_preferences?'+own,'PATCH',{push_categories:v.push_categories,center_categories:v.center_categories,quiet_start:v.quiet_start,quiet_end:v.quiet_end});}
 let config=await rpc('ms_notice_config');if(!config.vapid)config=await rpc('ms_notice_config',{p_vapid:webpush.generateVAPIDKeys()});
 const devices=/^[a-f0-9-]{36}$/.test(b.device_id||'')?await db('myspace_push_subscriptions?'+own+'&device_id=eq.'+b.device_id+'&select=enabled'):[];
 return out({prefs:(await db('myspace_notification_preferences?'+own))[0],public_key:config.vapid.publicKey,device_enabled:devices[0]?.enabled===true});
 }
 if(action==='subscribe'||action==='unsubscribe'){
 if(!/^[a-f0-9-]{36}$/.test(b.device_id||''))return out({error:'invalid_device'},400);
 if(action==='unsubscribe'){await db('myspace_push_subscriptions?'+own+'&device_id=eq.'+b.device_id,'PATCH',{enabled:false,updated_at:new Date().toISOString()});return out({ok:true});}
 if(!validSubscription(b.subscription))return out({error:'invalid_subscription'},400);
 const existing=await db('myspace_push_subscriptions?'+own+'&select=id');if(existing.length>=10&&!await db('myspace_push_subscriptions?'+own+'&device_id=eq.'+b.device_id).then(x=>x.length))return out({error:'device_limit'},400);
 const endpointHash=await hash(b.subscription.endpoint);
 const occupied=await db('myspace_push_subscriptions?endpoint_hash=eq.'+endpointHash+'&select=id,user_id');if(occupied.some((x:any)=>x.user_id!==uid))return out({error:'subscription_conflict'},409);
 const record={user_id:uid,device_id:b.device_id,subscription:b.subscription,endpoint_hash:endpointHash,enabled:true,updated_at:new Date().toISOString()};
 const current=await db('myspace_push_subscriptions?'+own+'&device_id=eq.'+b.device_id+'&select=id,enabled');
 if(current.length&&!current[0].enabled)Object.assign(record,{created_at:new Date().toISOString()});
 if(current.length)await db('myspace_push_subscriptions?'+own+'&device_id=eq.'+b.device_id,'PATCH',record);else if(occupied.length)await db('myspace_push_subscriptions?'+own+'&endpoint_hash=eq.'+endpointHash,'PATCH',{...record,created_at:new Date().toISOString()});else await db('myspace_push_subscriptions','POST',record);
 return out({ok:true});
 }
 return out({error:'unknown_action'},400);
 }catch{return out({error:'request_failed'},500)}
});
