// Private Moda: existing Supabase Auth and owner-only bucket. No Telegram or public Pages writes.
const BUCKET='myspace-moda-drafts',MAX=5000000,ID=/^\d{4}-\d{2}-\d{2}-gcc-[a-f0-9]{16,64}$/,HASH=/^[a-f0-9]{64}$/;
const need=(ok,msg)=>{if(!ok)throw Error(msg)};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const path=(id,name)=>'drafts/'+id+'/'+name;
const validUrl=u=>{try{const p=new URL(u);return p.protocol==='https:'&&!p.username&&!p.password}catch{return false}};
export function validateManifest(m,id){
 need(m&&m.schema_version===1&&m.id===id&&ID.test(id)&&m.mode==='private_preview'&&m.publication_allowed===false&&m.rights_verified===false,'Invalid private manifest');
 need(HASH.test(m.cover_sha256)&&HASH.test(m.source_archive_sha256)&&typeof m.text==='string'&&m.text.length<=12000,'Invalid manifest metadata');
 need(Array.isArray(m.items)&&m.items.length===3,'Expected three items');
 const ids=new Set([m.cover_sha256]),urls=new Set();
 for(const i of m.items){need(i&&typeof i.name==='string'&&i.name.length>0&&i.name.length<=300&&typeof i.shop==='string'&&i.shop.length<=100&&validUrl(i.url)&&Number.isFinite(i.price)&&i.price>0&&i.price<=10000000&&HASH.test(i.photo_sha256)&&!ids.has(i.photo_sha256)&&!urls.has(i.url),'Invalid or duplicate product');ids.add(i.photo_sha256);urls.add(i.url)}
 return [...ids];
}
async function bytesOf(blob,limit){need(blob&&blob.size>0&&blob.size<=limit,'Invalid object size');return new Uint8Array(await blob.arrayBuffer())}
async function checkedJpeg(blob,hash){const b=await bytesOf(blob,MAX);need(b[0]===255&&b[1]===216&&b[2]===255&&await digest(b)===hash,'JPEG checksum mismatch');return blob.type==='image/jpeg'?blob:blob.slice(0,blob.size,'image/jpeg')}
async function download(store,name,signal){const {data,error}=await store.download(name,{}, {signal,cache:'no-store'});if(error)throw Error('Private object unavailable');return data}

const fingerprint=file=>file.metadata?.eTag||file.updated_at?JSON.stringify([file.id,file.updated_at,file.metadata?.eTag,file.metadata?.size]):'';
export function createPrivateReader(client,deadline,{cacheBytes=32000000}={}){
 const store=client.storage.from(BUCKET),scope=new AbortController();
 const photos=new Map(),downloads=new Map(),queue=[];
 let manifests=new Map(),running=0,bytes=0,catalog=null;

 // Metadata and photos share the same Storage concurrency limit.
 function pump(){
  while(running<3&&queue.length){
   const {signal,run,resolve,reject}=queue.shift();
   if(signal.aborted){reject(Error('Private request cancelled'));continue}
   running++;
   Promise.resolve().then(run).then(resolve,reject).finally(()=>{running--;pump()});
  }
 }
 function schedule(signal,run){return new Promise((resolve,reject)=>{queue.push({signal,run,resolve,reject});pump()})}
 async function list(prefix,options,signal){
  const {data,error}=await schedule(signal,()=>store.list(prefix,options,{signal,cache:'no-store'}));
  need(!error&&Array.isArray(data),'Private catalog unavailable');
  return data;
 }
 async function readCatalog(signal){
  const folders=await list('drafts',{limit:40,sortBy:{column:'name',order:'desc'}},signal);
  // Storage listing may repeat a virtual folder. Limit unique IDs, not listing rows.
  const ids=[...new Set(folders.map(x=>x?.name).filter(x=>typeof x==='string'&&ID.test(x)))].slice(0,20);
  const confirmed=new Map();
  const rows=await Promise.all(ids.map(async id=>{
   const files=new Map((await list('drafts/'+id,{limit:100},signal)).map(file=>[file.name,file]));
   // Only folders with a committed manifest are visible. A partial upload is not a card.
   const entry=files.get('manifest.json');if(!entry)return null;
   const version=fingerprint(entry),previous=manifests.get(id);
   const manifest=version&&previous?.version===version?previous.manifest:
    JSON.parse(new TextDecoder().decode(await bytesOf(await schedule(signal,()=>download(store,path(id,'manifest.json'),signal)),100000)));
   const keys=validateManifest(manifest,id);
   const privatePhotos=keys.map(hash=>{
    const name=hash+'.jpg',file=files.get(name),size=file?.metadata?.size;
    need(file&&(!Number.isFinite(size)||(size>0&&size<=MAX)),'Private JPEG unavailable');
    const object=path(id,name);
    return {object,hash,key:JSON.stringify([object,fingerprint(file)])};
   });
   confirmed.set(id,{version,manifest});
   return {id,type:'picks',text:manifest.text,items:manifest.items,meta:{status:'queued',sent_at:id.slice(0,10)},
    ready:true,media_sha256:manifest.cover_sha256,privatePreview:true,privatePhotos};
  }));
  need(!signal.aborted,'Private request cancelled');
  manifests=confirmed;
  return rows.filter(Boolean);
 }
 function prune(){
  for(const [key,entry] of photos){
   if(bytes<=cacheBytes)break;
   if(!entry.users){bytes-=entry.blob.size;photos.delete(key)}
  }
 }
 function getPhoto(photo){
  if(photos.has(photo.key))return Promise.resolve(photos.get(photo.key));
  if(downloads.has(photo.key))return downloads.get(photo.key);
  const request=deadline(async signal=>{
   const blob=await schedule(signal,async()=>checkedJpeg(await download(store,photo.object,signal),photo.hash));
   need(!signal.aborted,'Private request cancelled');
   return {blob,users:0,url:''};
  },12000,scope.signal).finally(()=>downloads.delete(photo.key));
  downloads.set(photo.key,request);
  return request;
 }
 return {
  load(){
   if(!catalog)catalog=deadline(readCatalog,15000,scope.signal).finally(()=>catalog=null);
   return catalog;
  },
  async acquire(photo){
   const entry=await getPhoto(photo);
   need(!scope.signal.aborted,'Private session closed');
   // Keep verified bytes in RAM. Keep a Blob URL only while at least one image uses it.
   if(!entry.url)entry.url=URL.createObjectURL(entry.blob);
   entry.users++;
   if(!photos.has(photo.key))bytes+=entry.blob.size;
   photos.delete(photo.key);photos.set(photo.key,entry);prune();
   let released=false;
   return {url:entry.url,release(){
    if(released)return;released=true;
    if(--entry.users===0&&entry.url){URL.revokeObjectURL(entry.url);entry.url=''}
    prune();
   }};
  },
  close(){
   scope.abort();manifests.clear();
   for(const entry of photos.values()){if(entry.url)URL.revokeObjectURL(entry.url);entry.url=''}
   photos.clear();bytes=0;
  }
 };
}
async function immutablePut(store,name,blob,signal){
 need(!signal?.aborted,'Private session closed');
 const {error}=await store.upload(name,blob,{contentType:blob.type,upsert:false,cacheControl:'0'});
 need(!signal?.aborted,'Private session closed');
 if(error){const previous=await download(store,name,signal);need(await digest(await bytesOf(previous,MAX))===await digest(await bytesOf(blob,MAX)),'Existing object differs; no overwrite')}
 const saved=await download(store,name,signal);need(await digest(await bytesOf(saved,MAX))===await digest(await bytesOf(blob,MAX)),'Uploaded bytes differ');
}
export async function importPrivate(client,pack,signal){
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
 for(const c of prepared){for(const key of c.keys)await immutablePut(store,path(c.id,key+'.jpg'),c.blobs[key],signal);await immutablePut(store,path(c.id,'manifest.json'),c.manifest,signal)}
 return prepared.length;
}
