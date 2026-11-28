import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {validateManifest,importPrivate,createPrivateReader} from '../miniapp/private-moda.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const network=fs.readFileSync(new URL('../miniapp/network.js',import.meta.url),'utf8');
const {msDeadline:deadline}=vm.runInNewContext(network+'\n;({msDeadline})',{AbortController,DOMException,setTimeout,clearTimeout});
const hex=async b=>Buffer.from(await crypto.subtle.digest('SHA-256',b)).toString('hex');
async function fixture(){
 const images={},keys=[];
 for(let i=0;i<4;i++){
  const b=Uint8Array.from([255,216,255,i,255,217]),hash=await hex(b);
  keys.push(hash);images[hash]=Buffer.from(b).toString('base64');
 }
 const id='2026-11-27-gcc-'+'a'.repeat(40);
 const manifest={schema_version:1,mode:'private_preview',id,publication_allowed:false,rights_verified:false,cover_sha256:keys[0],
  source_archive_sha256:'b'.repeat(64),text:'Preview',items:keys.slice(1).map((k,i)=>({photo_sha256:k,name:'Product '+i,shop:'Brand',url:'https://example.com/p'+i,price:1000}))};
 return {schema_version:1,mode:'private_preview_import',cards:[{manifest,images}]};
}
function fake({repeatFolders=false}={}){
 const objects=new Map(),writes=[],downloads=[],versions=new Map();
 let running=0,max=0,hang=false;
 const store={
  async upload(path,blob,options){writes.push(path);assert.equal(options.upsert,false);
   if(objects.has(path))return {error:{message:'exists'}};objects.set(path,blob);return {data:{}}},
  async download(path,_options,{signal,cache}){
   downloads.push(path);assert.equal(cache,'no-store');running++;max=Math.max(max,running);
   try{
    if(hang)await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
    await new Promise(r=>setTimeout(r,4));
    return objects.has(path)?{data:objects.get(path)}:{error:{message:'missing'}};
   }finally{running--}
  },
  async list(prefix){
   const names=[...new Set([...objects.keys()].filter(p=>p.startsWith(prefix+'/')).map(p=>p.slice(prefix.length+1).split('/')[0]))];
   const rows=names.map(name=>({name,id:prefix+'/'+name,updated_at:versions.get(prefix+'/'+name)||'v1',
    metadata:{size:objects.get(prefix+'/'+name)?.size}}));
   return {data:repeatFolders?rows.flatMap(x=>[x,x]):rows};
  }
 };
 const client={storage:{from(name){assert.equal(name,'myspace-moda-drafts');return store}}};
 return {objects,writes,downloads,versions,client,reader:options=>createPrivateReader(client,deadline,options),stall:()=>hang=true,max:()=>max};
}
test('package uploads the manifest last, reads owner media and repeats without overwrites',async()=>{
 const p=await fixture(),s=fake();assert.equal(await importPrivate(s.client,p),1);assert.equal(s.objects.size,5);
 assert.match(s.writes.at(-1),/manifest.json$/);await importPrivate(s.client,p);assert.equal(s.objects.size,5);
 const reader=s.reader(),[row]=await reader.load();
 assert.equal(row.privatePreview,true);assert.equal(row.items.length,3);assert.equal(row.privatePhotos.length,4);
 const lease=await reader.acquire(row.privatePhotos[0]);assert.match(lease.url,/^blob:/);reader.close();
 await assert.rejects(fetch(lease.url));
});
test('corrupted media and invalid publication flags fail before any upload',async()=>{
 const p=await fixture(),s=fake(),c=p.cards[0];c.images[c.manifest.cover_sha256]='AAAA';
 await assert.rejects(importPrivate(s.client,p));assert.equal(s.writes.length,0);
 c.manifest.publication_allowed=true;assert.throws(()=>validateManifest(c.manifest,c.manifest.id));
});
test('duplicate folder entries return unique cards and incomplete uploads stay hidden',async()=>{
 const p=await fixture(),s=fake({repeatFolders:true});const second=structuredClone(p.cards[0]);
 second.manifest.id='2026-11-27-gcc-'+'b'.repeat(40);
 await importPrivate(s.client,{...p,cards:[p.cards[0],second]});
 s.objects.set('drafts/2026-11-27-gcc-'+'c'.repeat(40)+'/partial.jpg',new Blob(['x']));
 const reader=s.reader(),rows=await reader.load();assert.equal(rows.length,2);assert.equal(new Set(rows.map(x=>x.id)).size,2);
 s.objects.delete(rows[0].privatePhotos[0].object);
 await assert.rejects(reader.load(),/JPEG unavailable/);reader.close();
});
test('gallery downloads only on demand, shares in-flight work and releases URLs independently of verified bytes',async()=>{
 const p=await fixture(),s=fake();await importPrivate(s.client,p);s.downloads.length=0;
 const reader=s.reader();
 const first=reader.load();assert.equal(reader.load(),first);const [row]=await first;
 assert.equal(s.downloads.length,1);assert.match(s.downloads[0],/manifest.json$/);
 const [cover,...rest]=row.privatePhotos;
 const [a,b,...other]=await Promise.all([cover,cover,...rest].map(photo=>reader.acquire(photo)));
 assert.equal(s.downloads.length,5);assert.equal(s.max(),3);assert.equal(a.url,b.url);
 a.release();assert.ok((await fetch(b.url)).ok);b.release();await assert.rejects(fetch(b.url));
 await reader.load();assert.equal(s.downloads.length,5);
 const reused=await reader.acquire(cover);assert.equal(s.downloads.length,5);assert.notEqual(reused.url,b.url);
 reader.close();for(const lease of [reused,...other])await assert.rejects(fetch(lease.url));
});
test('a changed Storage version is rechecked against SHA-256 before it can be displayed',async()=>{
 const s=fake();await importPrivate(s.client,await fixture());
 const reader=s.reader(),[row]=await reader.load(),[photo]=row.privatePhotos;
 (await reader.acquire(photo)).release();
 s.objects.set(photo.object,new Blob([Uint8Array.of(255,216,255,99)]));s.versions.set(photo.object,'v2');
 const [updated]=await reader.load();assert.notEqual(updated.privatePhotos[0].key,photo.key);
 await assert.rejects(reader.acquire(updated.privatePhotos[0]),/JPEG checksum mismatch/);reader.close();
});
test('bounded cache evicts unreferenced bytes and logout aborts a hanging download',async()=>{
 const s=fake();await importPrivate(s.client,await fixture());
 const reader=s.reader({cacheBytes:6}),[row]=await reader.load(),[first,second,third]=row.privatePhotos;
 (await reader.acquire(first)).release();(await reader.acquire(second)).release();
 const before=s.downloads.length;(await reader.acquire(first)).release();assert.equal(s.downloads.length,before+1);
 s.stall();const pending=reader.acquire(third);await new Promise(r=>setImmediate(r));reader.close();
 await assert.rejects(pending,/прерван/);
});
test('deadline covers an incomplete response body even when it does not honor cancellation',async()=>{
 const ctx=vm.createContext({fetch:async()=>({ok:true,json:()=>new Promise(()=>{})}),AbortController,DOMException,setTimeout,clearTimeout});
 vm.runInContext(network,ctx);
 await assert.rejects(ctx.msRequestJSON('/catalog.json',{},10),{name:'TimeoutError'});
});
