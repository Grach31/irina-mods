import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';import {validateManifest,importPrivate,loadPrivate,release} from '../miniapp/private-moda.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const hex=async b=>Buffer.from(await crypto.subtle.digest('SHA-256',b)).toString('hex');
async function fixture(){
 const images={},keys=[];
 for(let i=0;i<4;i++){const b=Uint8Array.from([255,216,255,i,255,217]),hash=await hex(b);keys.push(hash);images[hash]=Buffer.from(b).toString('base64')}
 const id='2026-11-27-gcc-'+'a'.repeat(40);
 const manifest={schema_version:1,mode:'private_preview',id,publication_allowed:false,rights_verified:false,cover_sha256:keys[0],source_archive_sha256:'b'.repeat(64),text:'Preview',items:keys.slice(1).map((k,i)=>({photo_sha256:k,name:'Product '+i,shop:'Brand',url:'https://example.com/p'+i,price:1000}))};
 return {schema_version:1,mode:'private_preview_import',cards:[{manifest,images}]}
}
function fake(){
 const objects=new Map(),calls=[];
 return {objects,calls,client:{storage:{from(name){assert.equal(name,'myspace-moda-drafts');return {async upload(path,blob,options){calls.push(path);assert.equal(options.upsert,false);if(objects.has(path))return {error:{message:'exists'}};objects.set(path,blob);return {data:{}}},async download(path){return objects.has(path)?{data:objects.get(path)}:{error:{message:'missing'}}},async list(){return {data:[...new Set([...objects.keys()].map(p=>p.split('/')[1]))].map(name=>({name}))}}}}}}
}
test('private package uploads manifest last, reads owner media, repeats without overwrites',async()=>{const p=await fixture(),s=fake();assert.equal(await importPrivate(s.client,p),1);assert.equal(s.objects.size,5);assert.match(s.calls.at(-1),/manifest.json$/);await importPrivate(s.client,p);assert.equal(s.objects.size,5);const rows=await loadPrivate(s.client);assert.equal(rows.length,1);assert.equal(rows[0].privatePreview,true);assert.equal(rows[0].items.length,3);assert.match(rows[0].privateCover,/^blob:/);release(rows)});
test('reject corrupted media and invalid public or duplicated manifest before uploads',async()=>{const p=await fixture(),s=fake();const c=p.cards[0];c.images[c.manifest.cover_sha256]='AAAA';await assert.rejects(importPrivate(s.client,p));assert.equal(s.calls.length,0);c.manifest.publication_allowed=true;assert.throws(()=>validateManifest(c.manifest,c.manifest.id))});
