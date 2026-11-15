import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../miniapp/index.html',import.meta.url),'utf8');
const start=html.indexOf('const fashionSafeUrl=value=>{'),end=html.indexOf('const fashionDate=',start);
const escapeCode=html.slice(html.indexOf('const escapeHtml=')).split('\n')[0];
const context={URL};vm.runInNewContext(escapeCode+'\n'+html.slice(start,end)+'\nglobalThis.render=fashionArt;',context);
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
