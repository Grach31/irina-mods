import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildEditorial,handleEditorial,findsPhoto} from '../supabase/functions/myspace-publish/editorial.ts';
import {downloadPublicationPhotos,visibleCaption} from '../supabase/functions/myspace-publish/core.ts';
const photo='https://brand.example/photo.jpg';
const news={id:'news-1',title:'Новая коллекция',summary:'Краткая выжимка.',why:'Почему это интересно.',source:'Издание',url:'https://source.example/article',image_url:photo,image_credit:'Бренд / Издание'};
const history={id:'history-1',title:'История моды',year:1947,period:'1940-е',description:'Полный исходный текст.',then:'Исходный абзац «Тогда».',now:'Исходный абзац «Сейчас».',photos:[{url:photo,caption:'Подпись к архивному фото',credit:'Музей',source_url:'https://museum.example/item'}]};
test('Fashion Daily requires a real photo and safely formats prepared summary and edited text',()=>{
 assert.throws(()=>buildEditorial('fashion',{...news,image_url:null}),/editorial_photo_required/);
 const p=buildEditorial('fashion',news,'Мой заголовок\n\nТекст <без HTML>');assert(p.html.includes('&lt;без HTML&gt;'));assert(p.html.includes(news.url));assert(p.plain.includes('Фото: Бренд'));assert.equal(p.parts.length,1);
});
test('Time Machine preserves every displayed original field, photograph, caption and source',()=>{
 const p=buildEditorial('history',history,'Ignore client rewrite');for(const s of [history.title,history.description,history.then,history.now,history.photos[0].caption,history.photos[0].credit])assert(p.plain.includes(s));assert(p.html.includes(history.photos[0].source_url));assert.deepEqual(p.photos,[photo]);assert(!p.plain.includes('Ignore client rewrite'));
});
test('long full text splits without truncation, broken HTML or surrogate pairs',()=>{
 const text='Очень длинный исходный текст 🤍 '.repeat(500);const p=buildEditorial('history',{...history,description:text});assert(p.parts.length>2);const chunks=p.parts.filter(x=>x.kind==='text').map(x=>visibleCaption(x.html));assert(chunks.join('').includes(text));for(const part of p.parts)assert(visibleCaption(part.html).length<=(part.kind==='media'?1024:4096));
});
function fixture({item=news,space='fashion',mode='ok',convertWebp}={}){
 let row=null,sendCount=0,photos=0,failedOnce=false,checkpoints=0;let photoTail=0;const sends=[];
 const response=(x,status=200)=>new Response(JSON.stringify(x),{status});
 const fetcher=async(url,opts={})=>{
  url=String(url);
  if(url.startsWith('https://brand.example/')||url.startsWith('https://basket-01.wbbasket.ru/')){
   if(space==='finds')assert.equal(opts.redirect,'error');photos++;if(mode==='image403'||(mode==='fallback'&&url===photo))return response({},403);if(mode==='webp'){const b=new Uint8Array(132);b.set(Buffer.from('RIFF'));b.set(Buffer.from('WEBP'),8);return new Response(b)}return new Response(new Uint8Array([255,216,255,...Array(197).fill(photoTail)]))}
  if(url.includes('api.telegram.org/')){
   sendCount++;const method=url.split('/').at(-1);sends.push(method);
   if(method==='sendMessage'&&!failedOnce&&mode==='failSecond'){failedOnce=true;return response({ok:false,error_code:400,description:'Bad Request'},400)}
   if(method==='sendMessage'&&mode==='timeoutSecond')throw Error('network');
   return response({ok:true,result:method==='sendMediaGroup'?JSON.parse(opts.body.get('media')).map((_,i)=>({message_id:100+sendCount+i})):{message_id:100+sendCount}});
  }
  if(url.includes('.json?publish='))return response({items:[item]});
  throw Error('Unexpected '+url);
 };
 const rpc=async(name,p)=>{
  if(name==='ms_ep_claim'){
   if(row&&['published','publishing','uncertain'].includes(row.status))return {error:{published:'already_published',publishing:'already_processing',uncertain:'delivery_unconfirmed'}[row.status]};
   if(row?.next_part>0&&row.revision!==p.p_revision)return {error:'partial_revision_changed'};
   row={...row,status:'publishing',revision:p.p_revision,plan:p.p_plan,next_part:row?.next_part||0,message_ids:row?.message_ids||[],attempt_id:'attempt'};return {ok:true,...row};
  }
  if(name==='ms_ep_checkpoint'){
   checkpoints++;if(mode==='checkpointFailure')throw Error('database');assert.equal(p.p_part,row.next_part);row.message_ids.push(...p.p_ids);row.next_part++;row.status=row.next_part===row.plan.length?'published':'publishing';return {ok:true,...row};
  }
  if(name==='ms_ep_fail'){row.status=p.p_status;return true}throw Error(name);
 };
 const c={fetcher,convertWebp,rpc,db:async()=>row?[row]:[],hash:async s=>createHash('sha256').update(s).digest('hex'),credentials:async()=>({token:'test-token',channel:'@stamboi'})};
 return {call:(action,extra={})=>handleEditorial({action,space,id:item.id,...extra},c),get:()=>({row,sendCount,sends,photos,checkpoints}),changePhoto:()=>photoTail++};
}
test('preview is read-only; publication needs its exact approved revision and blocks repeats',async()=>{
 const f=fixture();const p=await f.call('editorial_preview');assert.equal(f.get().sendCount,0);assert.equal(f.get().row,null);
 assert.equal((await f.call('editorial_publish',{revision:'outdated'})).body.error,'editorial_changed');assert.equal(f.get().sendCount,0);
 const sent=await f.call('editorial_publish',{revision:p.body.revision,text:p.body.text});assert.equal(sent.body.status,'published');assert.equal(f.get().sendCount,1);
 assert.equal((await f.call('editorial_publish',{revision:p.body.revision,text:p.body.text})).body.error,'already_published');assert.equal(f.get().sendCount,1);
});
test('a changed photo or inaccessible media cannot be sent under the old approval',async()=>{
 const f=fixture();const p=await f.call('editorial_preview');f.changePhoto();assert.equal((await f.call('editorial_publish',{revision:p.body.revision})).body.error,'editorial_changed');assert.equal(f.get().sendCount,0);
 const missing=fixture({mode:'image403'});assert.equal((await missing.call('editorial_preview')).body.error,'media_download_failed');assert.equal(missing.get().row,null);
});
test('Time Machine sends all photos as a single album when appropriate',async()=>{
 const f=fixture({space:'history',item:{...history,photos:[...history.photos,{url:'https://brand.example/second.jpg',caption:'Второе фото',credit:'Музей'}]}});const p=await f.call('editorial_preview');assert.equal(p.body.photos.length,2);const r=await f.call('editorial_publish',{revision:p.body.revision});assert.equal(r.body.status,'published');assert.deepEqual(f.get().sends,['sendMediaGroup']);assert.equal(r.body.message_ids.length,2);
});
test('a confirmed failure resumes at the unsent text and never repeats the photograph',async()=>{
 const f=fixture({space:'history',item:{...history,description:'Полный текст. '.repeat(100)},mode:'failSecond'});const p=await f.call('editorial_preview');
 assert.equal((await f.call('editorial_publish',{revision:p.body.revision})).status,502);assert.equal(f.get().row.next_part,1);
 assert.equal((await f.call('editorial_publish',{revision:p.body.revision})).body.status,'published');assert.deepEqual(f.get().sends,['sendPhoto','sendMessage','sendMessage']);
});
test('an ambiguous partial delivery blocks retries',async()=>{
 const f=fixture({space:'history',item:{...history,description:'Полный текст. '.repeat(100)},mode:'timeoutSecond'});const p=await f.call('editorial_preview');assert.equal((await f.call('editorial_publish',{revision:p.body.revision})).body.error,'delivery_unconfirmed');const n=f.get().sendCount;assert.equal(f.get().row.status,'uncertain');assert.equal((await f.call('editorial_publish',{revision:p.body.revision})).body.error,'delivery_unconfirmed');assert.equal(f.get().sendCount,n);
});
test('failed acknowledgement storage retries only storage, not Telegram',async()=>{
 const f=fixture({mode:'checkpointFailure'});const p=await f.call('editorial_preview');await f.call('editorial_publish',{revision:p.body.revision});assert.equal(f.get().sendCount,1);assert.equal(f.get().checkpoints,3);assert.equal(f.get().row.status,'uncertain');
});

test('Finds previews and sends actual photos, copy and the matching Wildberries product after approval',async()=>{
 const item={id:'wb-123',title:'Сумка',category:'Сумки',description:'Мягкая сумка',stylist:'Добавь к жакету.',
  wb_article:'123',price:2000,url:'https://www.wildberries.ru/catalog/123/detail.aspx',
  photos:[{url:'https://basket-01.wbbasket.ru/photo/1.jpg'},{url:'https://basket-01.wbbasket.ru/photo/2.jpg'}]};
 assert.throws(()=>buildEditorial('finds',{...item,url:item.url.replace('123','456')}),/editorial_unavailable/);
 assert.throws(()=>buildEditorial('finds',{...item,photos:[{url:photo},item.photos[1]]}),/editorial_photo_required/);
 const f=fixture({space:'finds',item});const preview=await f.call('editorial_preview');
 assert.equal(preview.status,200);assert.equal(f.get().sendCount,0);
 for(const value of [item.title,item.description,item.stylist,item.url])assert(preview.body.html.includes(value));
 const sent=await f.call('editorial_publish',{revision:preview.body.revision});
 assert.equal(sent.body.status,'published');assert.deepEqual(f.get().sends,['sendMediaGroup']);
});

test('Finds accepts direct originals on Wildberries regional CDN for the matching product',()=>{
 const url='https://mow-basket-cdn-57.geobasket.ru/vol10271/part1027167/1027167295/images/big/1.webp?picsUpdate=0';
 assert.equal(findsPhoto(url,'1027167295'),url);
 assert.throws(()=>findsPhoto(url,'1027167296'),/editorial_photo_required/);
 assert.throws(()=>findsPhoto(url.replace('geobasket.ru','geobasket.ru.example.org'),'1027167295'),/editorial_photo_required/);
});
test('The optional Finds WebP converter prepares a JPEG while other publication paths stay strict',async()=>{
 const webp=new Uint8Array(132);webp.set(Buffer.from('RIFF'));webp.set(Buffer.from('WEBP'),8);
 const fetcher=async()=>new Response(webp);
 await assert.rejects(downloadPublicationPhotos(['https://example.org/1.webp'],fetcher),/media_format_invalid/);
 const jpg=new Uint8Array(132);jpg.set([255,216,255]);
 const [photo]=await downloadPublicationPhotos(['https://example.org/1.webp'],fetcher,async bytes=>{
  assert.deepEqual(bytes,webp);return jpg;
 });
 assert.equal(photo.mime,'image/jpeg');
 assert.deepEqual(photo.bytes,jpg);
});

test('Fashion and history use the same WebP normalization before moderation',async()=>{for(const [space,item] of [['fashion',news],['history',history]]){let calls=0;const f=fixture({space,item,mode:'webp',convertWebp:async bytes=>{calls++;assert.equal(String.fromCharCode(...bytes.slice(8,12)),'WEBP');const jpg=new Uint8Array(132);jpg.set([255,216,255]);return jpg}});const p=await f.call('editorial_preview');assert.equal(p.status,200);assert.equal(calls,1);assert.equal(f.get().sendCount,0)}});
test('Fashion uses only an attributed approved fallback and binds it to the preview',async()=>{const url='https://brand.example/fallback.jpg';const f=fixture({mode:'fallback',item:{...news,image_fallbacks:[{url,credit:'Official fallback',source_url:'https://brand.example/article',rights:'publisher_preview_hotlink'}]}});const p=await f.call('editorial_preview');assert.equal(p.status,200);assert.deepEqual(p.body.photos,[url]);assert(p.body.html.includes('Official fallback'));assert(!p.body.html.includes(news.image_credit));assert.equal(f.get().sendCount,0);const no=fixture({mode:'fallback',item:{...news,image_fallbacks:[{url,credit:'No rights',source_url:'https://brand.example/article'}]}});assert.equal((await no.call('editorial_preview')).body.error,'media_download_failed')});
