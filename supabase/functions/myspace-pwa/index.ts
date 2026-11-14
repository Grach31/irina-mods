// My Space PWA: signed Telegram -> one-time pairing -> short-lived private browser session.
// All database access is service-role server-side. Never expose raw health data or keys.
const enc=new TextEncoder(),dec=new TextDecoder();
const HDR={"Content-Type":"application/json","Access-Control-Allow-Origin":"https://grach31.github.io",
 "Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"content-type",
 "Cache-Control":"no-store","Referrer-Policy":"no-referrer"};
const respond=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:HDR});
const b64=(v:string)=>Uint8Array.from(atob(v.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(v.length/4)*4,"=")),c=>c.charCodeAt(0));
const hex=(v:Uint8Array)=>[...v].map(b=>b.toString(16).padStart(2,"0")).join("");
const hashed=async(v:string)=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(v))));
const secret=(n:number)=>hex(crypto.getRandomValues(new Uint8Array(n)));
const allowed=(id:string)=>id==="880098519"||(id==="731539637"&&Date.now()<Date.parse("2026-11-19T21:00:00Z"));
function creds(){
 const url=Deno.env.get("SUPABASE_URL");
 let key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!key)try{const x=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");key=typeof x.default==="string"?x.default:x.default?.api_key}catch{}
 if(!url||!key)throw Error("db_config");
 return {url,key};
}
async function db(table:string,method:string,query="",body?:unknown,representation=false){
 const {url,key}=creds();
 const result=await fetch(url+"/rest/v1/"+table+query,{
  method,
  headers:{"apikey":key,"Authorization":"Bearer "+key,
   ...(body!==undefined?{"Content-Type":"application/json"}:{}),
   ...(representation?{"Prefer":"return=representation"}:{})},
  ...(body!==undefined?{body:JSON.stringify(body)}:{})
 });
 if(!result.ok)throw Error("database_"+result.status);
 return representation||method==="GET"?await result.json():null;
}
async function verifyTelegram(raw:string,botId:string){
 if(!raw||raw.length>12000||!/^\d{5,16}$/.test(botId))return null;
 const p=new URLSearchParams(raw),sig=p.get("signature"),stamp=Number(p.get("auth_date"));
 if(!sig||!Number.isFinite(stamp)||stamp<Math.floor(Date.now()/1000)-86400||stamp>Date.now()/1000+60)return null;
 const check=botId+":WebAppData\n"+Array.from(p.entries()).filter(([k])=>k!=="hash"&&k!=="signature").map(([k,v])=>k+"="+v).sort().join("\n");
 const pub=Uint8Array.from("e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d".match(/../g)!,c=>parseInt(c,16));
 const key=await crypto.subtle.importKey("raw",pub,{name:"Ed25519"},false,["verify"]);
 if(!await crypto.subtle.verify("Ed25519",key,b64(sig),enc.encode(check)))return null;
 try{const user=JSON.parse(p.get("user")||"{}");const id=String(user.id);return allowed(id)?id:null}catch{return null}
}
async function validateSession(raw:string){
 if(!/^[a-f0-9]{64}$/.test(raw))return null;
 const rows=await db("stambo_pwa_sessions","GET","?token_hash=eq."+await hashed(raw)+"&select=telegram_user_id,expires_at&limit=1");
 const row=rows[0];const id=String(row?.telegram_user_id||"");
 return row&&new Date(row.expires_at).getTime()>Date.now()&&allowed(id)?id:null;
}
async function botAuth(jwt:string){
 if(jwt.length>12000)return false;
 const chunks=jwt.split(".");if(chunks.length!==3)return false;
 const head=JSON.parse(dec.decode(b64(chunks[0]))),p=JSON.parse(dec.decode(b64(chunks[1])));
 const now=Math.floor(Date.now()/1000);
 if(head.alg!=="RS256"||!head.kid||p.iss!=="https://token.actions.githubusercontent.com"||
  p.aud!=="stambo-pwa-actions"||p.repository!=="Grach31/irina-mods"||p.ref!=="refs/heads/main"||
  p.workflow_ref!=="Grach31/irina-mods/.github/workflows/bot.yml@refs/heads/main"||
  !["schedule","workflow_dispatch"].includes(p.event_name)||p.exp<now||p.iat>now+60||p.iat<now-600)return false;
 const response=await fetch("https://token.actions.githubusercontent.com/.well-known/jwks",{signal:AbortSignal.timeout(5000)});
 if(!response.ok)return false;
 const jwks=await response.json();
 const k=jwks.keys.find((x:Record<string,string>)=>x.kid===head.kid&&x.kty==="RSA");if(!k)return false;
 const key=await crypto.subtle.importKey("jwk",k,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
 return crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,b64(chunks[2]),enc.encode(chunks[0]+"."+chunks[1]));
}
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:HDR});
 if(request.method!=="POST")return respond({error:"method_not_allowed"},405);
 try{
  const b=await request.json(),action=String(b?.action||"");
  // Deprecated Telegram login/pairing and bot delivery endpoints: no longer part of My Space.
  if(["bot_issue","bot_pending","bot_ack","independent_login","independent_enroll","pair_start","pair_claim","passkey_bootstrap"].includes(action))return respond({error:"legacy_route_disabled"},410);
  if(action==="bot_pending"||action==="bot_ack"){
   const jwt=String(request.headers.get("authorization")||"").replace(/^Bearer /i,"");
   if(!await botAuth(jwt))return respond({error:"unauthorized"},403);
   if(action==="bot_pending"){
    const queue=await db("stambo_pwa_actions","GET","?status=eq.pending&select=id,draft_id,decision,telegram_user_id&order=created_at.asc&limit=25");
    return respond({actions:queue});
   }
   const ids=Array.isArray(b.ids)?b.ids.filter((x:unknown)=>typeof x==="string"&&/^[a-f0-9-]{36}$/.test(x)).slice(0,25):[];
   if(!ids.length)return respond({ok:true});
   await db("stambo_pwa_actions","PATCH","?id=in.("+ids.join(",")+")&status=eq.pending",
      {status:"completed",completed_at:new Date().toISOString()});
   return respond({ok:true});
  }
  if(action==="webhook_config"){
   const jwt=String(request.headers.get("authorization")||"").replace(/^Bearer /i,"");
   if(!await botAuth(jwt))return respond({error:"unauthorized"},403);
   const token=String(b.bot_token||""),webhookSecret=String(b.webhook_secret||"");
   if(!/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(token)||!/^[A-Za-z0-9_-]{32,128}$/.test(webhookSecret))return respond({error:"invalid_config"},400);
   await db("myspace_telegram_webhook_config","POST","?on_conflict=id",{id:1,bot_token:token,secret_hash:await hashed(webhookSecret),configured_at:new Date().toISOString()});
   return respond({ok:true});
  }
  if(action==="bot_issue"){
   const jwt=String(request.headers.get("authorization")||"").replace(/^Bearer /i,"");
   if(!await botAuth(jwt))return respond({error:"unauthorized"},403);
   if(String(b.telegram_user_id)!=="880098519")return respond({error:"forbidden"},403);
   const code=secret(10);
   await db("stambo_pwa_pairs","POST","",{code_hash:await hashed(code),telegram_user_id:880098519,expires_at:new Date(Date.now()+10*60*1000).toISOString()});
   return respond({code,expires_minutes:10});
  }
  if(action==="session_exchange"){
   const accessToken=String(b.access_token||"");
   if(!accessToken.startsWith("eyJ")||accessToken.split(".").length!==3)return respond({error:"unauthorized"},401);
   const {url,key}=creds();
   const auth=await fetch(url+"/auth/v1/user",{headers:{"apikey":key,"Authorization":"Bearer "+accessToken}});
   if(!auth.ok)return respond({error:"unauthorized"},401);
   const user=await auth.json();
   if(user.id!=="9983fe8e-9a69-4ed5-b8ec-f8e056c2f280")return respond({error:"forbidden"},403);
   const token=secret(32);
   await db("stambo_pwa_sessions","POST","",{token_hash:await hashed(token),telegram_user_id:880098519,expires_at:new Date(Date.now()+30*86400*1000).toISOString()});
   return respond({token,can_moderate:true});
  }
  if(action==="independent_login"){
   const code=String(b.code||"").trim().toLowerCase();
   if(!/^[a-f0-9]{64}$/.test(code))return respond({error:"invalid_login_code"},403);
   const rows=await db("myspace_login_credentials","GET","?owner_id=eq.880098519&select=token_hash&limit=1");
   if(!rows.length||rows[0].token_hash!==await hashed(code))return respond({error:"invalid_login_code"},403);
   const token=secret(32);
   await db("stambo_pwa_sessions","POST","",{token_hash:await hashed(token),telegram_user_id:880098519,expires_at:new Date(Date.now()+30*86400*1000).toISOString()});
   return respond({token,can_moderate:true});
  }
  if(action==="independent_enroll"){
   const userId=await validateSession(String(b.session||""));
   if(userId!=="880098519")return respond({error:"owner_session_required"},403);
   const code=secret(32);
   const rows=await db("myspace_login_credentials","GET","?owner_id=eq.880098519&select=owner_id");
   if(rows.length)await db("myspace_login_credentials","PATCH","?owner_id=eq.880098519",{token_hash:await hashed(code),created_at:new Date().toISOString()});
   else await db("myspace_login_credentials","POST","",{owner_id:880098519,token_hash:await hashed(code)});
   return respond({code,warning:"Save this recovery key. It will only be displayed once."});
  }
  if(action==="pair_start"){
   const snapshots=await db("stambo_oura_snapshot","GET","?id=eq.1&select=payload&limit=1");
   const botId=String(snapshots[0]?.payload?.bot_id||"");
   const userId=await verifyTelegram(String(b.initData||""),botId);
   if(!userId)return respond({error:"telegram_not_authorized"},403);
   const code=secret(10);
   await db("stambo_pwa_pairs","POST","",{code_hash:await hashed(code),telegram_user_id:Number(userId),
      expires_at:new Date(Date.now()+10*60*1000).toISOString()});
   return respond({code,expires_minutes:10});
  }
  if(action==="pair_claim"){
   const code=String(b.code||"").replace(/[\s-]/g,"").toLowerCase();
   if(!/^[a-f0-9]{20}$/.test(code))return respond({error:"invalid_code"},400);
   const hash=await hashed(code);
   const rows=await db("stambo_pwa_pairs","GET","?code_hash=eq."+hash+"&select=telegram_user_id,expires_at&limit=1");
   const row=rows[0],userId=String(row?.telegram_user_id||"");
   if(!row||Date.now()>new Date(row.expires_at).getTime()||!allowed(userId))return respond({error:"code_expired_or_invalid"},403);
   // Invalidate one-time code before issuing a browser session.
   await db("stambo_pwa_pairs","DELETE","?code_hash=eq."+hash);
   const token=secret(32);
   const lifetime=userId==="731539637"?Date.parse("2026-11-19T21:00:00Z"):Date.now()+30*86400*1000;
   await db("stambo_pwa_sessions","POST","",{token_hash:await hashed(token),telegram_user_id:Number(userId),
       expires_at:new Date(lifetime).toISOString()});
   return respond({token,can_moderate:userId==="880098519",expires_at:new Date(lifetime).toISOString()});
  }
  if(action==="passkey_bootstrap"){
   const userId=await validateSession(String(b.session||""));
   if(userId!=="880098519")return respond({error:"owner_session_required"},403);
   const {url,key}=creds();
   const res=await fetch(url+"/auth/v1/admin/generate_link",{
    method:"POST",headers:{"apikey":key,"Authorization":"Bearer "+key,"Content-Type":"application/json"},
    body:JSON.stringify({type:"magiclink",email:"g.tatulyan@gmail.com"})});
   if(!res.ok)return respond({error:"auth_bootstrap_failed"},502);
   const data=await res.json();
   if(!data.hashed_token)return respond({error:"auth_bootstrap_unavailable"},502);
   return respond({token_hash:data.hashed_token});
  }
  const token=String(b.session||"");
  let userId=await validateSession(token);
  if(!userId&&/^eyJ[A-Za-z0-9_-]+\\./.test(token)){
   const {url,key}=creds();
   const response=await fetch(url+"/auth/v1/user",{headers:{"apikey":key,"Authorization":"Bearer "+token}});
   if(response.ok){const u=await response.json();if(u.id==="9983fe8e-9a69-4ed5-b8ec-f8e056c2f280")userId="880098519";}
  }
  if(!userId)return respond({error:"session_required"},401);
  if(action==="whoami"){const grants=await db("myspace_temporary_moderators","GET","?telegram_user_id=eq."+userId+"&select=expires_at&limit=1");return respond({ok:true,can_moderate:userId==="880098519"||!!(grants[0]&&Date.parse(grants[0].expires_at)>Date.now())});}
  if(action==="signout"){
   await db("stambo_pwa_sessions","DELETE","?token_hash=eq."+await hashed(token));return respond({ok:true});
  }
  if(action==="oura_read"){
   const rows=await db("stambo_oura_snapshot","GET","?id=eq.1&select=payload,updated_at&limit=1");
   if(!rows[0])return respond({error:"not_available"},404);
   const {bot_id,...safe}=rows[0].payload;
   return respond({...safe,updated_at:rows[0].updated_at});
  }
  if(action==="moda_action"){
   if(userId!=="880098519")return respond({error:"read_only"},403);
   const draftId=String(b.id||""),decision=String(b.decision||"");
   if(!/^[a-zA-Z0-9_.-]{1,100}$/.test(draftId)||!["ok","no"].includes(decision))return respond({error:"invalid_action"},400);
   await db("stambo_pwa_actions","POST","",{telegram_user_id:Number(userId),draft_id:draftId,decision});
   return respond({queued:true},202);
  }
  return respond({error:"unknown_action"},400);
 }catch(e){return respond({error:"request_failed"},500)}
});
