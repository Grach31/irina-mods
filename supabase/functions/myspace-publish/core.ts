export class TelegramRejected extends Error {}
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
