import {downloadPublicationPhotos,convertPublicationWebp,telegramRejection,visibleCaption} from './core.ts';
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const https=(s:unknown)=>{try{const u=new URL(String(s));if(u.protocol==='https:'&&!u.username&&!u.password)return u.href}catch{}throw Error('editorial_photo_required')};
export const editorialFiles:Record<string,string>={
 fashion:'fashion-daily.json',
 history:'style-time-machine.json',
 finds:'china-finds.json',
};
const findsCategories=new Set(['Одежда','Сумки','Обувь','Бижутерия']);
export function findsPhoto(value:unknown,article:string){
 const url=new URL(https(value));
 if(!/^\d{1,15}$/.test(article))throw Error('editorial_photo_required');
 const originalHost=/^basket-\d+\.(?:wbbasket\.ru|wb\.ru|wbstatic\.net)$/.test(url.hostname);
 const geoHost=/^[a-z]{3}-basket-cdn-\d+\.geobasket\.ru$/.test(url.hostname);
 const productImage=new RegExp(`^/vol\\d+/part\\d+/${article}/images/big/\\d+\\.webp$`).test(url.pathname);
 if(url.port||!(originalHost||(geoHost&&productImage))){
  throw Error('editorial_photo_required');
 }
 return url.href;
}
function findsLink(value:unknown,article:unknown){
 if(typeof article!=='string'||!/^\d{1,15}$/.test(article)||
  value!==`https://www.wildberries.ru/catalog/${article}/detail.aspx`)throw Error('editorial_unavailable');
 return value;
}
function chunks(s:string,max=3800){const out:string[]=[];let part='';for(const c of s){if(part.length+c.length>max){out.push(part);part=''}part+=c}if(part)out.push(part);return out}
function format(s:string,first=false){if(!first)return escape(s);const n=s.indexOf('\n');return '<b>'+escape(n<0?s:s.slice(0,n))+'</b>'+(n<0?'':escape(s.slice(n)))}
export function buildEditorial(space:string,item:any,override?:string){
 if(!Object.hasOwn(editorialFiles,space)||!item?.title)throw Error('editorial_unavailable');
 let text:string,photos:string[],footer:string;
 if(space==='fashion'){
  photos=[https(item.image_url||item.image&&('https://grach31.github.io/irina-mods/'+item.image))];
  text=override??(typeof item.telegram_text==='string'?item.telegram_text:[item.title,item.summary,item.why].filter(Boolean).join('\n\n'));
  if(!text.trim()||text.length>12000)throw Error('editorial_text_invalid');
  footer='<a href="'+escape(https(item.url))+'">Источник: '+escape(item.source||'Оригинал')+'</a>';
  if(item.image_credit||item.image_source)footer+='\n<i>Фото: '+escape(item.image_credit||item.image_source)+'</i>';
  if(item._publication_fallback_source)footer+='\n<a href="'+escape(https(item._publication_fallback_source))+'">Источник фотографии</a>';
 }else if(space==='finds'){
  const url=findsLink(item.url,item.wb_article);
  if(item.id!=='wb-'+item.wb_article||!findsCategories.has(item.category)||
   !Number.isFinite(item.price)||item.price<=0)throw Error('editorial_unavailable');
  if(!Array.isArray(item.photos)||item.photos.length<2||item.photos.length>10)throw Error('editorial_photo_required');
  photos=[...new Set<string>(item.photos.map((p:{url:unknown})=>findsPhoto(p?.url,item.wb_article)))];
  if(photos.length!==item.photos.length)throw Error('editorial_photo_required');
  if(typeof item.description!=='string'||!item.description.trim()||typeof item.stylist!=='string'||!item.stylist.trim()||
   item.description.length>1200||item.stylist.length>800)throw Error('editorial_text_invalid');
  text=[item.title,item.price.toLocaleString('ru-RU')+' ₽ · Артикул '+item.wb_article,
   item.description,'Совет стилиста: '+item.stylist].join('\n\n');
  footer='<a href="'+escape(url)+'">Открыть на Wildberries</a>';
 }else{
  if(!Array.isArray(item.photos)||!item.photos.length)throw Error('editorial_photo_required');
  photos=[...new Set(item.photos.map((p:any)=>https(p.url)))];
  text=[item.title,[item.year,item.period].filter(Boolean).join(' · '),item.summary||item.description||item.hook,
   item.then&&'Тогда\n'+item.then,item.now&&'Сейчас\n'+item.now].filter(Boolean).join('\n\n');
  footer=item.photos.map((p:any)=>[p.caption&&escape(p.caption),p.source_url?'<a href="'+escape(https(p.source_url))+'">Источник: '+escape(p.credit||'Архив')+'</a>':p.credit&&escape(p.credit)].filter(Boolean).join('\n')).join('\n\n');
  if(item.source_url&&!item.photos.some((p:any)=>p.source_url===item.source_url))footer+='\n\n<a href="'+escape(https(item.source_url))+'">Источник материала</a>';
  if(item.photo_note)footer+='\n\n'+escape(item.photo_note);
 }
 if(photos.length>30)throw Error('too_many_images');
 const html=format(text,true)+'\n\n'+footer,plain=visibleCaption(html);
 const parts:any[]=[];const inline=plain.length<=1024;
 for(let i=0;i<photos.length;i+=10)parts.push({kind:'media',photos:photos.slice(i,i+10),html:i===0?(inline?html:'<b>'+escape(item.title)+'</b>'):''});
 if(!inline){
  const texts=chunks(text);for(let i=0;i<texts.length;i++)parts.push({kind:'text',html:format(texts[i],i===0)});
  // Footer stays intact; links/HTML entities are never cut in the middle.
  if(visibleCaption(parts.at(-1).html+'\n\n'+footer).length<=4096)parts.at(-1).html+='\n\n'+footer;
  else if(visibleCaption(footer).length<=4096)parts.push({kind:'text',html:footer});else throw Error('editorial_text_invalid');
 }
 if(parts.some(p=>visibleCaption(p.html).length>(p.kind==='media'?1024:4096)))throw Error('editorial_text_invalid');
 return {text,photos,html,plain,parts};
}
type Context={db:(path:string,method?:string,data?:unknown)=>Promise<any>,rpc:(name:string,data:unknown)=>Promise<any>,hash:(s:string)=>Promise<string>,credentials:()=>Promise<{token:string,channel:string}>,fetcher?:typeof fetch,convertWebp?:(bytes:Uint8Array)=>Promise<Uint8Array>};
export async function handleEditorial(b:any,c:Context){
 const result=(body:any,status=200)=>({body,status}),fetcher=c.fetcher||fetch;
 const space=String(b.space||''),id=String(b.id||'');
 if(b.action==='editorial_list')return result({items:await c.db('myspace_editorial_publications?select=space,source_id,status,message_ids,error_code,next_part&limit=1000')});
 if(!Object.hasOwn(editorialFiles,space)||!(/^[a-zA-Z0-9_.-]{1,200}$/.test(id)))return result({error:'invalid_id'},400);
 if(b.action==='editorial_status')return result((await c.db('myspace_editorial_publications?space=eq.'+space+'&source_id=eq.'+id+'&select=status,message_ids,error_code,next_part'))[0]||{status:'draft'});
 try{
  const file=editorialFiles[space];
  const read=async(root:string)=>{const r=await fetcher(root+file+'?publish='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('editorial_unavailable');return r.json()};
  const [source,deployed]=await Promise.all([read('https://raw.githubusercontent.com/Grach31/irina-mods/main/miniapp/'),read('https://grach31.github.io/irina-mods/')]);
  const item=source.items?.find((x:any)=>x.id===id),live=deployed.items?.find((x:any)=>x.id===id);
  if(!item||!live)throw Error('editorial_unavailable');
  if(JSON.stringify(item)!==JSON.stringify(live))throw Error('editorial_changed');
  if(b.text!==undefined&&typeof b.text!=='string')throw Error('editorial_text_invalid');
  const mediaFetcher:typeof fetch=space==='finds'
   ?(url,init)=>fetcher(url,{...init,redirect:'error'})
   :fetcher;
  const convert=c.convertWebp||convertPublicationWebp;
  let post:ReturnType<typeof buildEditorial>,photos:Awaited<ReturnType<typeof downloadPublicationPhotos>>;
  try{
   post=buildEditorial(space,item,space==='fashion'?b.text:undefined);
   photos=await downloadPublicationPhotos(post.photos,mediaFetcher,convert);
  }catch(e){
   const code=String((e as Error).message);
   if(space!=='fashion'||!['editorial_photo_required','media_download_failed','media_format_invalid','media_size_invalid'].includes(code))throw e;
   let alternate:{post:ReturnType<typeof buildEditorial>,photos:Awaited<ReturnType<typeof downloadPublicationPhotos>>}|undefined;
   for(const fallback of (Array.isArray(item.image_fallbacks)?item.image_fallbacks:[]).slice(0,3)){
    if(fallback?.rights!=='publisher_preview_hotlink'||typeof fallback.credit!=='string'||!fallback.credit.trim())continue;
    try{
     const url=https(fallback.url),source=https(fallback.source_url);
     if(url===item.image_url)continue;
     const candidate=buildEditorial(space,{...item,image_url:url,image_credit:fallback.credit,image_source:fallback.credit,_publication_fallback_source:source},b.text);
     const media=await downloadPublicationPhotos(candidate.photos,mediaFetcher,convert);
     alternate={post:candidate,photos:media};break;
    }catch{}
   }
   if(!alternate)throw e;
   post=alternate.post;photos=alternate.photos;
  }
  const fingerprints=await Promise.all(photos.map(async p=>{const h=await crypto.subtle.digest('SHA-256',new Uint8Array(p.bytes).buffer);return Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,'0')).join('')}));
  const revision=await c.hash(JSON.stringify({item,parts:post.parts,fingerprints,version:1}));
  const status=(await c.db('myspace_editorial_publications?space=eq.'+space+'&source_id=eq.'+id+'&select=status,message_ids,error_code,next_part'))[0]||{status:'draft'};
  if(b.action==='editorial_preview')return result({...post,revision,status:status.status,message_ids:status.message_ids||[],next_part:status.next_part||0});
  if(b.action!=='editorial_publish')return result({error:'invalid_action'},400);
  if(revision!==b.revision)throw Error('editorial_changed');
  const credentials=await c.credentials();if(!credentials.token)throw Error('telegram_configuration_required');
  const claimed=await c.rpc('ms_ep_claim',{p_space:space,p_id:id,p_revision:revision,p_plan:post.parts});if(claimed.error)return result(claimed,409);
  let saved:any=claimed;
  for(let partIndex=claimed.next_part;partIndex<post.parts.length;partIndex++){
   const part=post.parts[partIndex];let answer:any;let accepted=false;
   try{
    let body:BodyInit,method:string,headers:Record<string,string>={};
    if(part.kind==='text'){method='sendMessage';body=JSON.stringify({chat_id:credentials.channel,text:part.html,parse_mode:'HTML',link_preview_options:{is_disabled:true}});headers={'Content-Type':'application/json'}}
    else{
     const media=part.photos.map((url:string)=>photos[post.photos.indexOf(url)]);const form=new FormData();form.set('chat_id',credentials.channel);
     if(media.length===1){method='sendPhoto';form.set('caption',part.html);form.set('parse_mode','HTML');form.set('photo',new Blob([new Uint8Array(media[0].bytes).buffer],{type:media[0].mime}),media[0].name)}
     else{method='sendMediaGroup';form.set('media',JSON.stringify(media.map((_:any,i:number)=>({type:'photo',media:'attach://photo'+i,...(i===0&&part.html?{caption:part.html,parse_mode:'HTML'}:{})}))));media.forEach((p:any,i:number)=>form.set('photo'+i,new Blob([new Uint8Array(p.bytes).buffer],{type:p.mime}),p.name))}
     body=form;
    }
    const r=await fetcher('https://api.telegram.org/bot'+credentials.token+'/'+method,{method:'POST',body,headers,signal:AbortSignal.timeout(20000)});answer=await r.json();
    if(answer.ok===false){const code=telegramRejection(Number(answer.error_code||r.status),String(answer.description||''));await c.rpc('ms_ep_fail',{p_space:space,p_id:id,p_attempt:claimed.attempt_id,p_status:'failed',p_error:code});return result({error:code,next_part:partIndex,description:String(answer.description||'').replaceAll(credentials.token,'[redacted]').replace(/https?:\/\/\S+/gi,'[url]').slice(0,300)},502)}
    if(!r.ok||answer.ok!==true)throw Error('delivery_unconfirmed');accepted=true;
    const messages=Array.isArray(answer.result)?answer.result:[answer.result];const expected=part.kind==='text'?1:part.photos.length;
    if(messages.length!==expected||messages.some((m:any)=>!Number.isSafeInteger(m?.message_id)))throw Error('delivery_unconfirmed');
    // Retry storing a known result, never retry sending it to Telegram.
    let checkpoint:any;for(let tries=0;tries<3;tries++){try{checkpoint=await c.rpc('ms_ep_checkpoint',{p_space:space,p_id:id,p_attempt:claimed.attempt_id,p_part:partIndex,p_ids:messages.map((m:any)=>m.message_id)});if(checkpoint.ok)break}catch{} }
    if(!checkpoint?.ok)throw Error('delivery_unconfirmed');saved=checkpoint;
   }catch{
    try{await c.rpc('ms_ep_fail',{p_space:space,p_id:id,p_attempt:claimed.attempt_id,p_status:'uncertain',p_error:accepted?'confirmation_store_failed':'delivery_unconfirmed'})}catch{}
    return result({error:'delivery_unconfirmed'},503);
   }
  }
  return result({ok:true,status:'published',message_ids:saved.message_ids,url:'https://t.me/stamboi/'+saved.message_ids[0]});
 }catch(e){const error=String((e as Error).message);const allowed=['editorial_unavailable','editorial_changed','editorial_photo_required','editorial_text_invalid','media_download_failed','media_size_invalid','media_format_invalid','too_many_images','telegram_configuration_required'];return result({error:allowed.includes(error)?error:'request_failed'},409)}
}
