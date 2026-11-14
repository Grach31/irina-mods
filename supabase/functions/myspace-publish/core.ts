export class TelegramRejected extends Error {}
export async function downloadPublicationPhotos(images:string[],fetcher:typeof fetch=fetch){
 const photos:{bytes:Uint8Array,mime:string,name:string}[]=[];let total=0;
 for(let start=0;start<images.length;start+=3){
 const batch=await Promise.all(images.slice(start,start+3).map(async(url,index)=>{
 const r=await fetcher(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('media_download_failed');
 if(Number(r.headers.get('content-length'))>10000000)throw Error('media_size_invalid');
 const reader=r.body?.getReader();if(!reader)throw Error('media_download_failed');
 const chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>10000000)throw Error('media_size_invalid');chunks.push(part.value)}}finally{await reader.cancel().catch(()=>{})}
 if(length<100)throw Error('media_size_invalid');
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const png=[137,80,78,71,13,10,26,10].every((value,i)=>bytes[i]===value);
 if(!jpeg&&!png)throw Error('media_format_invalid');
 return {bytes,mime:jpeg?'image/jpeg':'image/png',name:'photo'+(start+index)+(jpeg?'.jpg':'.png')};
 }));
 for(const photo of batch){total+=photo.bytes.length;if(total>40000000)throw Error('media_size_invalid');photos.push(photo)}
 }
 return photos;
}
export function telegramRejection(code:number,description:string){
 const d=description.toLowerCase();
 if(code===403)return 'telegram_bot_not_allowed';if(code===401)return 'telegram_token_invalid';
 if(d.includes('chat not found'))return 'telegram_chat_not_found';
 if(d.includes('not enough rights'))return 'telegram_bot_not_admin';
 if(d.includes('caption is too long'))return 'caption_too_long';
 if(d.includes('parse entities'))return 'caption_invalid';
 if(d.includes('http url')||d.includes('web page content'))return 'telegram_media_fetch_failed';
 if(d.includes('photo_invalid')||d.includes('image_process')||d.includes('photo_content')||d.includes('photo_dimensions'))return 'telegram_media_invalid';
 return 'telegram_api_'+code;
}
export function visibleCaption(html:string):string {
 const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
 return html.replace(/<\/?[a-z][^>]*>/gi,'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,v)=>{
 if(v[0]!=='#')return entities[v.toLowerCase()];const n=v[1]?.toLowerCase()==='x'?parseInt(v.slice(2),16):parseInt(v.slice(1),10);return n>=0&&n<=0x10ffff?String.fromCodePoint(n):'';
 });
}
export function validateCaption(html:string){
 if(!html||visibleCaption(html).length>1024)throw Error('caption_too_long');
 const stack:string[]=[];for(const tag of html.matchAll(/<\s*(\/?)\s*([a-z][a-z0-9-]*)\b[^>]*>/gi)){
 const name=tag[2].toLowerCase();if(!['b','i','a','strong','em','u','s','code','pre','blockquote','tg-spoiler'].includes(name))throw Error('caption_invalid');
 if(tag[1]){if(stack.pop()!==name)throw Error('caption_invalid')}else stack.push(name);
 }if(stack.length)throw Error('caption_invalid');
}
export function publicationMedia(draft:any,id:string){
 let images:string[]=[];
 if(draft.type==='album'&&Array.isArray(draft.photos))images=draft.photos.map((x:string)=>x.startsWith('https://')?x:'https://raw.githubusercontent.com/Grach31/irina-mods/main/'+x);
 else if(draft.type==='item'&&draft.image)images=[draft.image];
 else if(Array.isArray(draft.items))images=draft.items.map((x:any)=>String(x.img||''));
 if(images.some(x=>{try{const u=new URL(x);return u.protocol!=='https:'||!!u.username||!!u.password}catch{return true}}))throw Error('media_url_invalid');
 if(images.length>10)throw Error('too_many_images');return images;
}
