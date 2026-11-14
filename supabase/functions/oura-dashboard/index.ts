// Oura metrics: GitHub Actions OIDC for ingestion, Telegram Ed25519 for owner and expiring test-viewer reads.
const enc=new TextEncoder();
const headers={"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"https://grach31.github.io","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"content-type, authorization","Cache-Control":"no-store"};
const reply=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{status,headers});
const b64=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"=")),ch=>ch.charCodeAt(0));
const fromHex=(hex:string)=>new Uint8Array(hex.match(/../g)!.map(x=>parseInt(x,16)));
const parseJwt=(jwt:string)=>{const parts=jwt.split(".");if(parts.length!==3)throw Error("invalid jwt");return {parts,header:JSON.parse(new TextDecoder().decode(b64(parts[0]))),payload:JSON.parse(new TextDecoder().decode(b64(parts[1]))) }};
async function githubAuth(jwt:string){
 if(jwt.length>12000)return false;
 const {parts,header,payload}=parseJwt(jwt);
 const now=Math.floor(Date.now()/1000);
 if(header.alg!=="RS256"||!header.kid||payload.iss!=="https://token.actions.githubusercontent.com"||
    payload.aud!=="stambo-oura-dashboard"||payload.repository!=="Grach31/oura"||
    payload.ref!=="refs/heads/main"||!["schedule","workflow_dispatch","push"].includes(payload.event_name)||
    payload.exp<now||payload.iat>now+60||payload.iat<now-600||
    payload.workflow_ref!=="Grach31/oura/.github/workflows/oura.yml@refs/heads/main")return false;
 const r=await fetch("https://token.actions.githubusercontent.com/.well-known/jwks",{signal:AbortSignal.timeout(5000)});
 if(!r.ok)return false;
 const jwks=await r.json();const jwk=jwks.keys.find((key:Record<string,string>)=>key.kid===header.kid&&key.kty==="RSA");
 if(!jwk)return false;
 const cryptoKey=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
 return await crypto.subtle.verify("RSASSA-PKCS1-v1_5",cryptoKey,b64(parts[2]),enc.encode(parts[0]+"."+parts[1]));
}
async function telegramAuth(raw:string,botId:string,owner:string){
 if(!/^\d{5,16}$/.test(botId)||!raw||raw.length>12000)return false;
 const p=new URLSearchParams(raw);const signature=p.get("signature");const stamp=Number(p.get("auth_date"));
 if(!signature||!Number.isFinite(stamp)||stamp<Math.floor(Date.now()/1000)-86400||stamp>Date.now()/1000+60)return false;
 const check=botId+":WebAppData\n"+Array.from(p.entries()).filter(([k])=>k!=="hash"&&k!=="signature").map(([k,v])=>k+"="+v).sort().join("\n");
 const pub=fromHex("e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d");
 const key=await crypto.subtle.importKey("raw",pub,{name:"Ed25519"},false,["verify"]);
 const verified=await crypto.subtle.verify("Ed25519",key,b64(signature),enc.encode(check));
 if(!verified)return false;
 try{const id=String(JSON.parse(p.get("user")||"{}").id);return id===owner||(id==="731539637"&&Date.now()<Date.parse("2026-11-19T21:00:00Z"))}catch{return false}
}
function dbCreds(){
 const url=Deno.env.get("SUPABASE_URL");
 let key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!key){try{const x=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");key=typeof x.default==="string"?x.default:x.default?.api_key}catch{/**/}}
 return {url,key};
}
async function database(method:"GET"|"POST",payload?:Record<string,unknown>){
 const {url,key}=dbCreds();if(!url||!key)return {ok:false,status:503,data:null};
 const base=url+"/rest/v1/stambo_oura_snapshot";
 const res=await fetch(base+(method==="GET"?"?id=eq.1&select=payload,updated_at":"?on_conflict=id"),{
  method,headers:{"apikey":key,"Authorization":"Bearer "+key,...(method==="POST"?{"Content-Type":"application/json","Prefer":"resolution=merge-duplicates"}:{})},
  ...(method==="POST"?{body:JSON.stringify({id:1,payload,updated_at:new Date().toISOString()})}:{})
 });
 return {ok:res.ok,status:res.status,data:method==="GET"&&res.ok?await res.json():null};
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
 try{
  const body=await req.json();
  if(body.action==="ingest"){
   const bearer=(req.headers.get("authorization")||"").replace(/^Bearer /i,"");
   if(!await githubAuth(bearer))return reply({error:"github_oidc_unauthorized"},401);
   const data=body.data;
   if(!data||typeof data!=="object"||!["sleep","readiness","activity"].every(k=>data[k]&&typeof data[k]==="object"))return reply({error:"invalid_metrics"},400);
   const botId=String(body.bot_id||"");if(!/^\d{5,16}$/.test(botId))return reply({error:"invalid_bot_id"},400);
   const n=(v:unknown,lo=-1000,hi=100000000)=>typeof v==="number"&&Number.isFinite(v)&&v>=lo&&v<=hi?v:null;
   const str=(v:unknown,max=40)=>typeof v==="string"?v.slice(0,max):"";
   const day=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v:"";
   const duration=(v:unknown)=>n(v,0,172800);
   const score=(v:unknown)=>n(v,0,100);
   const d=data.sleep.detail||{};
   const rawHistory=Array.isArray(data.history)?data.history.slice(-30):[];
   const history=rawHistory.filter((x:any)=>x&&typeof x==="object").map((x:any)=>({
     day:day(x.day),sleep:score(x.sleep),readiness:score(x.readiness),activity:score(x.activity),
     temperature:n(x.temperature,-8,8),
     total_sleep_seconds:duration(x.total_sleep_seconds),deep_sleep_seconds:duration(x.deep_sleep_seconds),
     rem_sleep_seconds:duration(x.rem_sleep_seconds),
     light_sleep_seconds:duration(x.light_sleep_seconds),sleep_efficiency:n(x.sleep_efficiency,0,100),
     bedtime_start:str(x.bedtime_start),bedtime_end:str(x.bedtime_end),
     steps:n(x.steps,0,150000),active_calories:n(x.active_calories,0,15000),
     medium_activity_seconds:duration(x.medium_activity_seconds),
     high_activity_seconds:duration(x.high_activity_seconds)
   })).filter((x:any)=>x.day);
   const cycle=data.cycle&&typeof data.cycle==="object"?data.cycle:{};
   const safe={
     sleep:{score:score(data.sleep.score),detail:{
       day:day(d.day),total_seconds:duration(d.total_seconds),deep_seconds:duration(d.deep_seconds),
       rem_seconds:duration(d.rem_seconds),light_seconds:duration(d.light_seconds),
       awake_seconds:duration(d.awake_seconds),efficiency:n(d.efficiency,0,100),
       latency_seconds:duration(d.latency_seconds),bedtime_start:str(d.bedtime_start),
       bedtime_end:str(d.bedtime_end),hrv:n(d.hrv,0,400),resting_hr:n(d.resting_hr,20,220),
       average_hr:n(d.average_hr,20,220),
       sleep_phase_5_min:typeof d.sleep_phase_5_min==="string"&&/^[0-9]{0,300}$/.test(d.sleep_phase_5_min)?d.sleep_phase_5_min:""
     }},
     readiness:{score:score(data.readiness.score),temperature:n(data.readiness.temperature,-8,8),
       hrv:n(data.readiness.hrv,0,400),resting_hr:n(data.readiness.resting_hr,20,220)},
     activity:{score:score(data.activity.score),day:day(data.activity.day),
       steps:n(data.activity.steps,0,150000),active_calories:n(data.activity.active_calories,0,15000),
       total_calories:n(data.activity.total_calories,0,30000),
       high_activity_seconds:duration(data.activity.high_activity_seconds),
       medium_activity_seconds:duration(data.activity.medium_activity_seconds)},
     cycle:{day:n(cycle.day,1,200),period_start:day(cycle.period_start),
       predicted_next:day(cycle.predicted_next),avg_length:n(cycle.avg_length,20,40),
       has_history:cycle.has_history===true},
     history,bot_id:botId
   };
   const result=await database("POST",safe);
   return result.ok?reply({ok:true}):reply({error:"data_write_failed"},502);
  }
  if(body.action==="read"){
   const existing=await database("GET");
   if(!existing.ok)return reply({error:"data_unavailable"},503);
   const row=existing.data?.[0];if(!row)return reply({error:"no_recent_data"},404);
   // Read access: original report recipient plus one signed temporary test viewer until 2026-11-19 21:00 UTC.
   if(!await telegramAuth(String(body.initData||""),String(row.payload.bot_id||""),"880098519"))return reply({error:"telegram_not_authorized"},403);
   const {bot_id,...data}=row.payload;
   return reply({...data,updated_at:row.updated_at});
  }
  return reply({error:"unknown_action"},400);
 }catch(e){return reply({error:"request_failed"},500)}
});

