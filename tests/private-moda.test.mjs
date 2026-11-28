import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';import {MODA_CATEGORIES,validateManifest,importPrivate,loadPrivate,release,uniquePrivateRows} from '../miniapp/private-moda.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const hex=async b=>Buffer.from(await crypto.subtle.digest('SHA-256',b)).toString('hex');
async function fixture(){
 const images={},keys=[];
 for(let i=0;i<4;i++){const b=Uint8Array.from([255,216,255,i,255,217]),hash=await hex(b);keys.push(hash);images[hash]=Buffer.from(b).toString('base64')}
 const id='2026-11-27-gcc-'+'a'.repeat(40);
 const manifest={schema_version:1,mode:'private_preview',id,publication_allowed:false,rights_verified:false,cover_sha256:keys[0],source_archive_sha256:'b'.repeat(64),text:'Preview',items:keys.slice(1).map((k,i)=>({photo_sha256:k,name:'Product '+i,shop:'Brand',url:'https://example.com/p'+i,price:1000}))};
 return {schema_version:1,mode:'private_preview_import',cards:[{manifest,images}]}
}
function fake({repeatFolders=false}={}){
 const objects=new Map(),calls=[];
 const store={
  async upload(path,blob,options){calls.push(path);assert.equal(options.upsert,false);if(objects.has(path))return {error:{message:'exists'}};objects.set(path,blob);return {data:{}}},
  async download(path){return objects.has(path)?{data:objects.get(path)}:{error:{message:'missing'}}},
  async list(prefix){const folders=[...new Set([...objects.keys()].filter(p=>p.startsWith(prefix+'/')).map(p=>p.slice(prefix.length+1).split('/')[0]))].map(name=>({name}));return {data:repeatFolders?folders.flatMap(x=>[x,x]):folders}}
 };
 return {objects,calls,client:{storage:{from(name){assert.equal(name,'myspace-moda-drafts');return store}}}};
}
test('private package uploads manifest last, reads owner media, repeats without overwrites',async()=>{const p=await fixture(),s=fake();assert.equal(await importPrivate(s.client,p),1);assert.equal(s.objects.size,5);assert.match(s.calls.at(-1),/manifest.json$/);await importPrivate(s.client,p);assert.equal(s.objects.size,5);const rows=await loadPrivate(s.client);assert.equal(rows.length,1);assert.equal(rows[0].privatePreview,true);assert.equal(rows[0].items.length,3);assert.match(rows[0].privateCover,/^blob:/);release(rows)});
test('reject corrupted media and invalid public or duplicated manifest before uploads',async()=>{const p=await fixture(),s=fake();const c=p.cards[0];c.images[c.manifest.cover_sha256]='AAAA';await assert.rejects(importPrivate(s.client,p));assert.equal(s.calls.length,0);c.manifest.publication_allowed=true;assert.throws(()=>validateManifest(c.manifest,c.manifest.id))});

test('repeated Storage folder entries produce only one card per ID before the display limit',async()=>{
 const p=await fixture(),s=fake({repeatFolders:true});
 const second=structuredClone(p.cards[0]);second.manifest.id='2026-11-27-gcc-'+'b'.repeat(40);
 await importPrivate(s.client,{...p,cards:[p.cards[0],second]});
 const rows=await loadPrivate(s.client);
 assert.equal(rows.length,2);assert.equal(new Set(rows.map(x=>x.id)).size,2);
 assert.equal(s.objects.size,10);release(rows);
});
test('private catalog merge does not repeat IDs or revoke retained shared blobs',async()=>{
 const p=await fixture(),s=fake();await importPrivate(s.client,p);
 const rows=await loadPrivate(s.client),row=rows[0];
 const copy=(await loadPrivate(s.client))[0];
 const kept=uniquePrivateRows([], [row,row,copy]);
 assert.equal(kept.length,1);assert.equal(kept[0],row);
 assert.ok((await fetch(row.privateCover)).ok);
 await assert.rejects(fetch(copy.privateCover));
 assert.deepEqual(uniquePrivateRows([{id:row.id}],[row]),[]);
 await assert.rejects(fetch(row.privateCover));
});

test('incomplete upload is hidden, but a committed card with unavailable media fails refresh',async()=>{const p=await fixture(),s=fake();await importPrivate(s.client,p);const id=p.cards[0].manifest.id;const incomplete='2026-11-27-gcc-'+'c'.repeat(40);s.objects.set('drafts/'+incomplete+'/partial.jpg',new Blob(['x']));const rows=await loadPrivate(s.client);assert.equal(rows.length,1);release(rows);s.objects.delete('drafts/'+id+'/'+p.cards[0].manifest.cover_sha256+'.jpg');await assert.rejects(loadPrivate(s.client),/refresh incomplete/)});

test('five category manifests and a legacy card coexist and retain the source links and carousel',async()=>{
 const s=fake(),legacy=await fixture(),ids=[];
 await importPrivate(s.client,legacy);
 for(const [index,category] of Object.keys(MODA_CATEGORIES).entries()){
  const pack=await fixture(), card=pack.cards[0].manifest;
  card.id='2026-11-28-gcc-'+String(index+1).repeat(40);
  card.category=category;
  card.title='Заголовок подборки';
  ids.push(card.id);
  // The existing Publisher writes the receipt last. No UI import is involved here.
  for(const [digest,data] of Object.entries(pack.cards[0].images)){
   s.objects.set('drafts/'+card.id+'/'+digest+'.jpg',new Blob([Buffer.from(data,'base64')]));
  }
  s.objects.set('drafts/'+card.id+'/manifest.json',new Blob([JSON.stringify(card)]));
 }
 const rows=await loadPrivate(s.client);
 try{
  assert.equal(rows.length,6);
  for(const [index,category] of Object.keys(MODA_CATEGORIES).entries()){
   const row=rows.find(x=>x.id===ids[index]);
   assert.equal(row.modaCategory,category);
   assert.equal(row.privateModeration,true);
   assert.equal(row.title,'Заголовок подборки');
   const raw=await s.objects.get('drafts/'+row.id+'/manifest.json').arrayBuffer();
   assert.equal(row.revision,await hex(raw));
   assert.equal(row.privateUrls.length,4);
   assert(row.items.every(item=>item.url.startsWith('https://example.com/')&&item.img.startsWith('blob:')));
  }
  assert.equal(rows.find(row=>row.id===legacy.cards[0].manifest.id).privateModeration,undefined);
 }finally{release(rows)}
});
