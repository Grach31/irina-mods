import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../miniapp/index.html',import.meta.url),'utf8');
const start=html.indexOf('const fashionSafeUrl=value=>{'),end=html.indexOf('const fashionDate=',start);
const escapeCode=html.slice(html.indexOf('const escapeHtml=')).split('\n')[0];
const context={URL};vm.runInNewContext(escapeCode+'\n'+html.slice(start,end)+'\nglobalThis.render=fashionArt;globalThis.watch=fashionWatchImages;',context);
test('news photos are not restricted to the old publisher domain list',()=>{
 for(const image_url of ['https://hips.hearstapps.com/news.jpg','https://posta-magazine.ru/news.jpg','https://brand.example/press.jpg']){
  const rendered=context.render({image_url,brand:'News'});assert(rendered.includes('src="'+image_url+'"'));assert(rendered.includes('referrerpolicy="no-referrer"'));
 }
});
test('invalid image URLs cannot become executable image markup',()=>{
 for(const image_url of ['javascript:alert(1)','data:image/svg+xml,test','http://insecure.example/photo.jpg','https://user:password@example.com/photo.jpg'])assert(!context.render({image_url}).includes('<img'));
 const rendered=context.render({image_url:'https://example.com/a" onmouseover="alert(1)',image_alt:'" onload="alert(2)',image_credit:'" data-fake="x'});
 assert(!rendered.includes(' onmouseover="'));assert(rendered.includes('&quot;'));assert(!rendered.includes('data-fake="x'));
});
test('licensed local photos use the same load/failure fallback as external previews',()=>{
 assert(context.render({image:'images/fashion/press.jpg',image_rights:'licensed'}).includes('src="images/fashion/press.jpg"'));
 assert(!context.render({image:'images/fashion/press.jpg',image_rights:'unknown'}).includes('<img'));
 assert(context.render({}).includes('редакционная обложка'));
});
test('attributed HTTPS fallbacks are retained; unverified or unsafe alternatives are excluded',()=>{
 const rendered=context.render({image_url:'https://publisher.example/main.jpg',image_fallbacks:[
  {url:'https://backup.example/photo.jpg',credit:'Photographer / Publisher',source_url:'https://backup.example/article',rights:'publisher_preview_hotlink'},
  {url:'javascript:alert(1)',credit:'x',source_url:'https://backup.example/article',rights:'publisher_preview_hotlink'},
  {url:'https://unverified.example/photo.jpg'},
 ]});
 assert(rendered.includes('https://backup.example/photo.jpg'));assert(!rendered.includes('javascript:'));assert(!rendered.includes('https://unverified.example'));
});
test('a cached failed photo recovers through its fallback and updates attribution',()=>{
 const queue=[];context.setTimeout=fn=>{queue.push(fn);return queue.length};context.clearTimeout=()=>{};context.location={href:'https://app.example/'};
 const classes=new Set(),small={textContent:''},listeners={};
 const artwork={dataset:{photoCredit:'Primary',photoCandidates:JSON.stringify([{url:'https://one.example/a.jpg',credit:'Primary',alt:'First'},{url:'https://two.example/b.jpg',credit:'Backup author',alt:'Backup'}])},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},querySelector:()=>small};
 const img={dataset:{},parentElement:artwork,complete:true,naturalWidth:0,src:'https://one.example/a.jpg',addEventListener:(n,f)=>{listeners[n]=f}};
 context.watch({querySelectorAll:()=>[img]});assert.equal(queue.length,1);queue.shift()();
 assert.equal(img.src,'https://two.example/b.jpg');assert.equal(img.alt,'Backup');
 listeners.load();assert(classes.has('has-photo'));assert.equal(small.textContent,'Backup author · фото к новости');
});
test('persistent failure retries once and retains a clear unavailable state without looping',()=>{
 const queue=[];let timers=0;context.setTimeout=fn=>{queue.push(fn);return ++timers};context.clearTimeout=()=>{};context.location={href:'https://app.example/'};
 const classes=new Set(),small={textContent:''},listeners={};const artwork={dataset:{photoCredit:'Source',photoCandidates:'[]'},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},querySelector:()=>small};
 const img={dataset:{},parentElement:artwork,complete:false,naturalWidth:0,src:'https://one.example/a.jpg',addEventListener:(n,f)=>{listeners[n]=f}};
 context.watch({querySelectorAll:()=>[img]});listeners.error();queue.shift()();assert(img.src.includes('_ms_photo_retry='));
 listeners.error();assert.equal(queue.length,0);assert.equal(img.hidden,true);assert(classes.has('photo-unavailable'));assert(small.textContent.includes('временно недоступно'));
});
