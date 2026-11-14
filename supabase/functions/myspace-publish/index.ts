import {TelegramRejected,validateCaption,publicationMedia,downloadPublicationPhotos,telegramRejection} from './core.ts';
const enc=new TextEncoder();
const b64=(v:string)=>Uint8Array.from(atob(v.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(v.length/4)*4,"=")),x=>x.charCodeAt(0));
async function githubAuth(jwt:string){
 if(jwt.length>12000)return false;
 const parts=jwt.split(".");if(parts.length!==3)return false;
 const header=JSON.parse(new TextDecoder().decode(b64(parts[0])));
 const payload=JSON.parse(new TextDecoder().decode(b64(parts[1])));
 const now=Math.floor(Date.now()/1000);
 if(header.alg!=="RS256"||!header.kid||payload.iss!=="https://token.actions.githubusercontent.com"||payload.aud!=="myspace-telegram-transfer"||payload.repository!=="Grach31/irina-mods"||payload.ref!=="refs/heads/main"||payload.workflow_ref!=="Grach31/irina-mods/.github/workflows/myspace-telegram-transfer.yml@refs/heads/main"||!["push","workflow_dispatch"].includes(payload.event_name)||payload.exp<now||payload.iat>now+60||payload.iat<now-600)return false;
 const r=await fetch("https://token.actions.githubusercontent.com/.well-known/jwks");if(!r.ok)return false;
 const jwks=await r.json(),jwk=jwks.keys.find((x:any)=>x.kid===header.kid&&x.kty==="RSA");if(!jwk)return false;
 const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
 return crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,b64(parts[2]),enc.encode(parts[0]+"."+parts[1]));
}
const H={"Content-Type":"application/json","Access-Control-Allow-Origin":"https://grach31.github.io","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"content-type","Cache-Control":"no-store"};
const respond=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{status,headers:H});
const hex=(bytes:Uint8Array)=>[...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");
async function hash(v:string){return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))))}
const base=Deno.env.get("SUPABASE_URL")||"";
function secretKey(){let key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!key){try{const x=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");key=typeof x.default==="string"?x.default:x.default?.api_key}catch{}}if(!key)throw Error("db_key_missing");return key}
async function db(path:string,method="GET",payload?:unknown){const key=secretKey();const r=await fetch(base+"/rest/v1/"+path,{method,headers:{apikey:key,Authorization:"Bearer "+key,...(payload!==undefined?{"Content-Type":"application/json"}:{}),Prefer:"return=representation"},...(payload!==undefined?{body:JSON.stringify(payload)}:{})});if(!r.ok)throw Error("db_"+r.status);return r.json()}
async function moderator(session:string){if(!/^[a-f0-9]{64}$/.test(session))return null;const rows=await db("stambo_pwa_sessions?token_hash=eq."+await hash(session)+"&select=telegram_user_id,expires_at&limit=1");if(rows.length!==1||new Date(rows[0].expires_at).getTime()<=Date.now())return null;const id=String(rows[0].telegram_user_id);if(id==="880098519")return id;const grants=await db("myspace_temporary_moderators?telegram_user_id=eq."+id+"&select=expires_at&limit=1");return grants.length&&new Date(grants[0].expires_at).getTime()>Date.now()?id:null}
const rpc=(name:string,p:unknown)=>db('rpc/'+name,'POST',p);
const safeError=(e:unknown)=>String((e as Error)?.message||'request_failed');
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:H});
 if(req.method!=='POST')return respond({error:'method_not_allowed'},405);
 try{
 const rawBody=await req.text();if(rawBody.length>20000)return respond({error:'too_large'},413);
 const b=JSON.parse(rawBody),action=String(b.action||''),id=String(b.id||'');
 if(action==='diagnostics'){
 const bearer=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');
 if(!/^[a-f0-9]{64}$/.test(bearer))return respond({error:'unauthorized'},403);
 const config=await rpc('ms_notice_config',{});if(bearer!==config.worker_token)return respond({error:'unauthorized'},403);
 let token=Deno.env.get('MYSPACE_TELEGRAM_BOT_TOKEN')||'';let configured=Deno.env.get('MYSPACE_TELEGRAM_CHANNEL_ID')||'';
 if(!token||!configured){const rows=await db('myspace_telegram_credentials?select=bot_token,channel_id&id=eq.1');token=rows[0]?.bot_token||token;configured=String(rows[0]?.channel_id||configured)}
 const get=async(method:string,args:Record<string,unknown>={})=>{const r=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});return r.json()};
 const me=await get('getMe');if(!me.ok)return respond({error:'telegram_token_invalid'},502);
 const destinations=[];for(const chat_id of [...new Set(['@stamboi',configured].filter(Boolean))]){
 const chat=await get('getChat',{chat_id});const member=chat.ok?await get('getChatMember',{chat_id,user_id:me.result.id}):null;
 destinations.push({requested:chat_id,ok:chat.ok,description:chat.description,id:chat.result?.id,type:chat.result?.type,title:chat.result?.title,username:chat.result?.username,bot_status:member?.result?.status,can_post_messages:member?.result?.can_post_messages});
 }
 let media;if(id){if(!/^[a-zA-Z0-9_.-]{1,100}$/.test(id))return respond({error:'invalid_id'},400);
 const raw=await fetch('https://raw.githubusercontent.com/Grach31/irina-mods/main/drafts/'+encodeURIComponent(id)+'.json',{signal:AbortSignal.timeout(12000)});if(!raw.ok)return respond({error:'draft_unavailable'},404);
 const draft=await raw.json();validateCaption(String(draft.text||''));const photos=await downloadPublicationPhotos(publicationMedia(draft,id));media=photos.map(p=>({bytes:p.bytes.length,type:p.mime}));}
 return respond({bot:{id:me.result.id,username:me.result.username},destinations,media});
 }
 if(action==='credential_transfer'){
 const assertion=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');if(!await githubAuth(assertion))return respond({error:'github_oidc_unauthorized'},401);
 const token=String(b.token||''),channel=Number(b.channel_id);if(!/^\d{5,15}:[A-Za-z0-9_-]{25,}$/.test(token)||!Number.isSafeInteger(channel)||channel>=0)return respond({error:'invalid_credentials'},400);
 const key=secretKey();const saved=await fetch(base+'/rest/v1/myspace_telegram_credentials?on_conflict=id',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:JSON.stringify({id:1,bot_token:token,channel_id:channel})});
 return saved.ok?respond({ok:true,configured:true}):respond({error:'credential_store_failed'},502);
 }
 const moderatorId=await moderator(String(b.session||''));if(!moderatorId)return respond({error:'unauthorized'},403);
 if(action!=='list'&&!/^[a-zA-Z0-9_.-]{1,100}$/.test(id))return respond({error:'invalid_id'},400);
 if(action==='list'){
 const rows=await db('myspace_publications?select=draft_id,status,updated_at,error_code&order=updated_at.desc&limit=1000');
 const edits=await db('myspace_edit_requests?select=draft_id,created_at&order=created_at.desc&limit=1000');
 const completions=await db('myspace_edit_completions?select=draft_id,request_created_at&limit=1000');
 const complete=new Set(completions.map((r:any)=>r.draft_id+':'+Date.parse(r.request_created_at)));
 for(const e of edits){if(!complete.has(e.draft_id+':'+Date.parse(e.created_at))&&!rows.some((x:any)=>x.draft_id===e.draft_id&&['published','rejected','publishing','uncertain'].includes(x.status)))rows.push({draft_id:e.draft_id,status:'edit_requested',updated_at:e.created_at})}
 return respond({items:rows});
 }
 if(action==='status'){const rows=await db('myspace_publications?draft_id=eq.'+id+'&select=status,telegram_message_ids,updated_at,error_code');return respond(rows[0]||{status:'draft'})}
 if(action==='edit'||action==='reject'){
 const result=await rpc('ms_publication_decide',{p_id:id,p_action:action,p_notes:String(b.notes||''),p_owner:Number(moderatorId)});return respond(result,result.error?409:200);
 }
 if(action!=='publish')return respond({error:'invalid_action'},400);
 if(!/^[a-f0-9]{64}$/.test(b.revision||''))return respond({error:'revision_required'},409);
 const raw=await fetch('https://raw.githubusercontent.com/Grach31/irina-mods/main/drafts/'+encodeURIComponent(id)+'.json',{cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(!raw.ok)return respond({error:'draft_unavailable'},404);const rawText=await raw.text();
 if(await hash(rawText)!==b.revision)return respond({error:'draft_changed'},409);
 const catalogResponse=await fetch('https://grach31.github.io/irina-mods/catalog.json?approval='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(!catalogResponse.ok)return respond({error:'draft_not_ready'},409);
 const catalog=await catalogResponse.json();const deployed=catalog.items?.find((x:any)=>x.id===id);
 if(!deployed?.ready||deployed.revision!==b.revision)return respond({error:'draft_not_ready'},409);
 const draft=JSON.parse(rawText);if(draft.id!==id||draft.hold===true||draft.type==='test'||/(?:^|[-_])test(?:$|[-_])/i.test(id))return respond({error:'draft_held_or_invalid'},409);
 const caption=String(draft.text||'');validateCaption(caption);let images=publicationMedia(draft,id);
 if(!images.length){const root='https://raw.githubusercontent.com/Grach31/irina-mods/main/drafts/img/'+encodeURIComponent(id);for(let i=1;i<=10;i++){const url=root+(i===1?'':'-'+i)+'.jpg';const r=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(8000)});if(!r.ok||!r.headers.get('content-type')?.startsWith('image/'))break;images.push(url)}}
 if(!images.length)return respond({error:'draft_has_no_media'},409);
 let token=Deno.env.get('MYSPACE_TELEGRAM_BOT_TOKEN')||'',channel=Deno.env.get('MYSPACE_TELEGRAM_CHANNEL_ID')||'';
 if(!token||!channel){const stored=await db('myspace_telegram_credentials?select=bot_token,channel_id&id=eq.1');token=stored[0]?.bot_token||token;channel=String(stored[0]?.channel_id||channel)}
 if(!token)return respond({error:'telegram_configuration_required'},503);channel='@stamboi';
 // Download every photo BEFORE claiming. Telegram receives bytes, never store/CDN URLs.
 const photos=await downloadPublicationPhotos(images);
 const claimed=await rpc('ms_publication_decide',{p_id:id,p_action:'claim',p_revision:b.revision});if(claimed.error)return respond(claimed,409);
 const attempt=claimed.attempt_id;let sent:any;
 try{
 const form=new FormData();form.set('chat_id',channel);let method:string;
 if(photos.length===1){method='sendPhoto';form.set('caption',caption);form.set('parse_mode','HTML');const p=photos[0];form.set('photo',new Blob([new Uint8Array(p.bytes).buffer],{type:p.mime}),p.name)}
 else{method='sendMediaGroup';form.set('media',JSON.stringify(photos.map((_,i)=>({type:'photo',media:'attach://photo'+i,...(i===0?{caption,parse_mode:'HTML'}:{})}))));photos.forEach((p,i)=>form.set('photo'+i,new Blob([new Uint8Array(p.bytes).buffer],{type:p.mime}),p.name))}
 const r=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',body:form,signal:AbortSignal.timeout(20000)});
 const answer=await r.json();
 if(answer.ok===false){const e=new TelegramRejected(telegramRejection(Number(answer.error_code||r.status),String(answer.description||'')));Object.assign(e,{description:String(answer.description||'').replaceAll(token,'[redacted]').replace(/https?:\/\/\S+/gi,'[url]').slice(0,300)});throw e}
 if(!r.ok||answer.ok!==true)throw Error('delivery_unconfirmed');
 sent=Array.isArray(answer.result)?answer.result:[answer.result];if(sent.length!==photos.length||sent.some((x:any)=>!Number.isSafeInteger(x?.message_id)))throw Error('delivery_unconfirmed');
 }catch(e){const definite=e instanceof TelegramRejected;try{await rpc('ms_publication_finish',{p_id:id,p_attempt:attempt,p_status:definite?'failed':'uncertain',p_error:definite?safeError(e):'delivery_unconfirmed'})}catch{}
 return respond({error:definite?safeError(e):'delivery_unconfirmed',...(definite?{description:(e as any).description}:{})},502);
 }
 const messageIds=sent.map((m:any)=>m.message_id);
 for(let i=0;i<3;i++){try{const saved=await rpc('ms_publication_finish',{p_id:id,p_attempt:attempt,p_status:'published',p_ids:messageIds});if(saved)return respond({ok:true,status:'published',message_ids:messageIds})}catch{}if(i<2)await new Promise(r=>setTimeout(r,200*(i+1)))}
 // Keep the durable claim on every ambiguous outcome; never reopen it for retry.
 try{await rpc('ms_publication_finish',{p_id:id,p_attempt:attempt,p_status:'uncertain',p_ids:messageIds,p_error:'confirmation_store_failed'})}catch{}
 return respond({error:'delivery_unconfirmed'},503);
 }catch(e){const message=safeError(e);const allowed=['caption_too_long','caption_invalid','media_download_failed','media_size_invalid','media_format_invalid','media_url_invalid','too_many_images'];return respond({error:allowed.includes(message)?message:'request_failed'},allowed.includes(message)?409:500)}
});
