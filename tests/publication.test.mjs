import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import {stripTypeScriptTypes} from 'node:module';import {createHash,webcrypto} from 'node:crypto';
import {visibleCaption,validateCaption,downloadPublicationPhotos,telegramRejection} from '../supabase/functions/myspace-publish/core.ts';
const root=new URL('../',import.meta.url),file=new URL('supabase/functions/myspace-publish/',root);
const core=stripTypeScriptTypes(fs.readFileSync(new URL('core.ts',file),'utf8')).replace(/export /g,'');
const index=stripTypeScriptTypes(fs.readFileSync(new URL('index.ts',file),'utf8')).replace(/^import .*\n/,'');
const actual=JSON.parse(fs.readFileSync(new URL('drafts/2026-11-14-mix-knit-and-satin.json',root),'utf8'));
test('HTML link markup does not count toward the Telegram caption limit',()=>{assert(actual.text.length>1024);assert(visibleCaption(actual.text).length<1024);assert.doesNotThrow(()=>validateCaption(actual.text));assert.throws(()=>validateCaption('a'.repeat(1025)));assert.throws(()=>validateCaption('<b>unclosed'))});
function fixture({mode='ok',ready=true}={}){
 let handler,state=null,sends=0,finishAttempts=0,requests=[],uploads=[];const raw=JSON.stringify(actual);const revision=createHash('sha256').update(raw).digest('hex');const response=(x,status=200)=>new Response(JSON.stringify(x),{status});
 const fetch=async(input,opts={})=>{const url=String(input),method=opts.method||'GET',body=typeof opts.body==='string'?JSON.parse(opts.body):null;
 if(url.includes('/stambo_pwa_sessions'))return response([{telegram_user_id:880098519,expires_at:'2030-01-01T00:00:00Z'}]);
 if(url.includes('/rpc/ms_publication_decide')){
 if(['publishing','published','uncertain'].includes(state))return response({error:state==='published'?'already_published':state==='uncertain'?'delivery_unconfirmed':'already_processing'});
 if(body.p_action==='edit'){requests.push(body.p_notes);return response({ok:true,status:'edit_requested'})}
 state='publishing';return response({ok:true,attempt_id:'11111111-1111-4111-8111-111111111111'});
 }
 if(url.includes('/rpc/ms_publication_finish')){finishAttempts++;if(mode==='storage_failure')return response({},500);state=body.p_status;return response(true)}
 if(actual.items.some(x=>x.img===url)){if(mode==='media_unavailable')return response({},403);return new Response(new Uint8Array([255,216,255,...Array(197).fill(0)]))}
 if(url.startsWith('https://raw.githubusercontent.com/'))return new Response(raw);
 if(url.includes('catalog.json'))return response({items:[{id:actual.id,revision,ready}]});
 if(url.includes('api.telegram.org/')){sends++;uploads.push(opts.body);if(mode==='network_failure')throw Error('connection lost');if(mode==='rejected')return response({ok:false,error_code:403},403);if(mode==='photo_rejected')return response({ok:false,error_code:400,description:'Bad Request: PHOTO_INVALID_DIMENSIONS'},400);return response({ok:true,result:[{message_id:1},{message_id:2},{message_id:3}]})}
 throw Error('Unmocked URL: '+url);
 };
 vm.runInNewContext(core+'\n'+index,{Deno:{env:{get:n=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'mock-key',MYSPACE_TELEGRAM_BOT_TOKEN:'mock-token',MYSPACE_TELEGRAM_CHANNEL_ID:'mock-channel'})[n]},serve:fn=>handler=fn},fetch,Response,Request,TextEncoder,TextDecoder,crypto:webcrypto,atob,URL,Date,Uint8Array,FormData,Blob,AbortSignal,setTimeout,console});
 return {call:async(action='publish',rev=revision)=>{const r=await handler(new Request('https://function.test',{method:'POST',body:JSON.stringify({action,id:actual.id,session:'a'.repeat(64),revision:rev,notes:'Another requested correction'})}));return {status:r.status,data:await r.json()}},get:()=>({state,sends,finishAttempts,requests,uploads})};
}
test('current long HTML caption publishes successfully in isolated transport',async()=>{const f=fixture();assert.equal((await f.call()).status,200);assert.equal(f.get().sends,1)});
test('changed revision and unfinished images cannot start a publication',async()=>{let f=fixture();assert.equal((await f.call('publish','b'.repeat(64))).data.error,'draft_changed');assert.equal(f.get().sends,0);f=fixture({ready:false});assert.equal((await f.call()).data.error,'draft_not_ready');assert.equal(f.get().state,null)});
test('ambiguous Telegram response blocks a second send',async()=>{const f=fixture({mode:'network_failure'});assert.equal((await f.call()).data.error,'delivery_unconfirmed');assert.equal(f.get().state,'uncertain');assert.equal((await f.call()).status,409);assert.equal(f.get().sends,1)});
test('acknowledgement storage failure retries storage only, never Telegram',async()=>{const f=fixture({mode:'storage_failure'});assert.equal((await f.call()).data.error,'delivery_unconfirmed');assert.equal((await f.call()).status,409);assert.equal(f.get().sends,1);assert.equal(f.get().finishAttempts,4)});
test('confirmed Telegram rejection stays retryable',async()=>{const f=fixture({mode:'rejected'});assert.equal((await f.call()).status,502);assert.equal(f.get().state,'failed')});
test('album uploads real photo bytes with matching attach references, not store URLs',async()=>{const f=fixture();await f.call();const form=f.get().uploads[0];assert(form instanceof FormData);const media=JSON.parse(form.get('media'));assert.equal(media.length,3);for(let i=0;i<3;i++){assert.equal(media[i].media,'attach://photo'+i);assert.equal(form.get('photo'+i).size,200);assert.equal(form.get('photo'+i).type,'image/jpeg')}assert.equal(media[0].caption,actual.text);assert.equal(media[1].caption,undefined)});
test('an unavailable photo cannot claim or send a partial album',async()=>{const f=fixture({mode:'media_unavailable'});assert.equal((await f.call()).data.error,'media_download_failed');assert.equal(f.get().state,null);assert.equal(f.get().sends,0)});
test('HTML masquerading as an image is rejected before send',async()=>{await assert.rejects(downloadPublicationPhotos(['https://test/image.jpg'],async()=>new Response('<html>'+'.'.repeat(200)+'</html>')),/media_format_invalid/)});
test('Telegram explanation distinguishes photo errors and remains available',async()=>{assert.equal(telegramRejection(400,'Bad Request: failed to get HTTP URL content'),'telegram_media_fetch_failed');const f=fixture({mode:'photo_rejected'});const r=await f.call();assert.equal(r.data.error,'telegram_media_invalid');assert.equal(r.data.description,'Bad Request: PHOTO_INVALID_DIMENSIONS');assert.equal(f.get().state,'failed')});
test('diagnostics cannot use a normal moderator session to bypass internal authorization',async()=>{const f=fixture();assert.equal((await f.call('diagnostics')).status,403);assert.equal(f.get().sends,0)});
