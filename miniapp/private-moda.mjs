// Read the private Moda bucket using the existing My Space Auth session.
const BUCKET='myspace-moda-drafts',MAX=5000000,ID=/^\d{4}-\d{2}-\d{2}-gcc-[a-f0-9]{16,64}$/,HASH=/^[a-f0-9]{64}$/;
export const MODA_CATEGORIES=Object.freeze({clothing:'Одежда',bags:'Сумки',shoes:'Обувь',jewelry:'Украшения',accessories:'Аксессуары'});
const need=(ok,msg)=>{if(!ok)throw Error(msg)};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const path=(id,name)=>'drafts/'+id+'/'+name;
const validUrl=u=>{try{const p=new URL(u);return typeof u==='string'&&p.protocol==='https:'&&!p.username&&!p.password}catch{return false}};
export function validateManifest(m,id){
 need(m&&m.schema_version===1&&m.id===id&&ID.test(id)&&m.mode==='private_preview'&&m.publication_allowed===false&&m.rights_verified===false,'Invalid private manifest');
 need(HASH.test(m.cover_sha256)&&HASH.test(m.source_archive_sha256)&&typeof m.text==='string'&&m.text.length<=12000,'Invalid manifest metadata');
 if('category' in m||'title' in m)need(Object.hasOwn(MODA_CATEGORIES,m.category)&&typeof m.title==='string'&&m.title.trim()===m.title&&m.title.length>=1&&m.title.length<=75&&!/[\x00-\x1f]/.test(m.title),'Invalid collection metadata');
 need(Array.isArray(m.items)&&m.items.length===3,'Expected three items');
 const ids=new Set([m.cover_sha256]),urls=new Set();
 for(const i of m.items){need(i&&typeof i.name==='string'&&i.name.length>0&&i.name.length<=300&&typeof i.shop==='string'&&i.shop.length<=100&&validUrl(i.url)&&(!('original_photo_url' in i)||validUrl(i.original_photo_url))&&Number.isFinite(i.price)&&i.price>0&&i.price<=10000000&&HASH.test(i.photo_sha256)&&!ids.has(i.photo_sha256)&&!urls.has(i.url),'Invalid or duplicate product');ids.add(i.photo_sha256);urls.add(i.url)}
 return [...ids];
}
async function bytesOf(blob,limit){need(blob&&blob.size>0&&blob.size<=limit,'Invalid object size');return new Uint8Array(await blob.arrayBuffer())}
async function checkedJpeg(blob,hash){const b=await bytesOf(blob,MAX);need(b[0]===255&&b[1]===216&&b[2]===255&&await digest(b)===hash,'JPEG checksum mismatch');return new Blob([b],{type:'image/jpeg'})}
async function download(store,name){const {data,error}=await store.download(name);if(error)throw Error('Private object unavailable');return data}
async function readCard(store,id){
 const bytes=await bytesOf(await download(store,path(id,'manifest.json')),100000);
 const manifest=JSON.parse(new TextDecoder().decode(bytes));
 const keys=validateManifest(manifest,id),blobs={};
 for(const key of keys)blobs[key]=await checkedJpeg(await download(store,path(id,key+'.jpg')),key);
 const urls=Object.fromEntries(keys.map(key=>[key,URL.createObjectURL(blobs[key])]));
 return {id,type:'picks',text:manifest.text,items:manifest.items.map(({name,shop,price,url,photo_sha256,original_photo_url})=>({name,shop,price,url,img:urls[photo_sha256],original_photo_url})),
  meta:{status:'queued',sent_at:id.slice(0,10)},ready:true,media_sha256:manifest.cover_sha256,privatePreview:true,privateCover:urls[manifest.cover_sha256],privateUrls:Object.values(urls),
  ...(manifest.category?{modaCategory:manifest.category,title:manifest.title,revision:await digest(bytes),privateModeration:true}: {})};
}
export function release(rows){for(const row of rows||[])for(const url of row.privateUrls||[])URL.revokeObjectURL(url)}
export async function loadPrivate(client){
 const store=client.storage.from(BUCKET),{data,error}=await store.list('drafts',{limit:40,sortBy:{column:'name',order:'desc'}});
 if(error)throw Error('Private catalog unavailable');
 const rows=[];
 // Storage listing may repeat a virtual folder. Limit unique IDs, not listing rows.
 const ids=[...new Set((data||[]).filter(x=>x&&typeof x.name==='string'&&ID.test(x.name)).map(x=>x.name))].slice(0,20);
 try{
  for(const id of ids){
   // Only folders with a committed manifest are visible. A partial upload is not a card.
   const listing=await store.list('drafts/'+id,{limit:100});
   if(listing.error||!Array.isArray(listing.data))throw Error('Private folder unavailable');
   if(!listing.data.some(row=>row.name==='manifest.json'))continue;
   rows.push(await readCard(store,id));
  }
  return rows;
 }catch(e){release(rows);throw Error('Private catalog refresh incomplete')}
}
export function uniquePrivateRows(publicRows,privateRows){
 // Keep each private draft ID exactly once, even if an upstream listing repeats it.
 // An existing public ID keeps its original moderation behavior. Different outfits
 // and different public IDs are never silently hidden.
 const seen=new Set(publicRows.map(d=>d.id)),kept=[],dropped=[];
 for(const row of privateRows){
  if(seen.has(row.id))dropped.push(row);else{seen.add(row.id);kept.push(row)}
 }
 // Do not revoke a shared blob URL if a repeated row references the same object.
 const retained=new Set(kept.flatMap(row=>row.privateUrls||[]));
 for(const row of dropped)for(const url of row.privateUrls||[])if(!retained.has(url))URL.revokeObjectURL(url);
 return kept;
}
async function immutablePut(store,name,blob){
 const {error}=await store.upload(name,blob,{contentType:blob.type,upsert:false,cacheControl:'0'});
 if(error){const previous=await download(store,name);need(await digest(await bytesOf(previous,MAX))===await digest(await bytesOf(blob,MAX)),'Existing object differs; no overwrite')}
 const saved=await download(store,name);need(await digest(await bytesOf(saved,MAX))===await digest(await bytesOf(blob,MAX)),'Uploaded bytes differ');
}
export async function importPrivate(client,pack){
 need(pack?.schema_version===1&&pack.mode==='private_preview_import'&&Array.isArray(pack.cards)&&pack.cards.length>=1&&pack.cards.length<=2,'Invalid import package');
 const prepared=[],ids=new Set();
 // Validate the entire pack before any remote writes.
 for(const card of pack.cards){
  const m=card.manifest,keys=validateManifest(m,m?.id);need(!ids.has(m.id),'Duplicate card');ids.add(m.id);
  need(card.images&&Object.keys(card.images).length===keys.length,'Invalid image set');const blobs={};
  for(const key of keys){const encoded=card.images[key];need(typeof encoded==='string'&&encoded.length<=6666668,'Invalid image encoding');const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));blobs[key]=await checkedJpeg(new Blob([bytes],{type:'image/jpeg'}),key)}
  const manifest=new Blob([JSON.stringify(m)],{type:'application/json'});need(manifest.size<=100000,'Manifest too large');prepared.push({id:m.id,keys,blobs,manifest});
 }
 const store=client.storage.from(BUCKET);
 for(const c of prepared){for(const key of c.keys)await immutablePut(store,path(c.id,key+'.jpg'),c.blobs[key]);await immutablePut(store,path(c.id,'manifest.json'),c.manifest)}
 return prepared.length;
}
