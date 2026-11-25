const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve('miniapp');
const server = http.createServer((req,res)=>{
 const name = new URL(req.url,'http://localhost').pathname.replace(/^\/irina-mods\//,'') || 'index.html';
 const file = path.resolve(root,name);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end()}
 const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
 res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
 for(const engine of [chromium,webkit]){
 const browser=await engine.launch();
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**/*',r=>r.abort());
 await page.route('**/china-finds.json',r=>r.fulfill({json:{items:[{id:'fixture',title:'Test bag',category:'Сумки',price:1000,description:'Test only',url:'https://www.wildberries.ru/catalog/123/detail.aspx',photos:[]}]}}));
 await page.goto('http://127.0.0.1:'+server.address().port+'/irina-mods/');
 // Bypass the visual login gate only in this isolated UI test; never authenticate against production.
 await page.evaluate(()=>{for(const id of ['pwaGate','pwaBoot']){const e=document.getElementById(id);e.classList.add('hidden');e.style.display='none'}});
 await page.locator('#openFinds').evaluate(e=>e.click());
 await page.getByText('Test bag',{exact:true}).waitFor();
 await page.locator('[data-finds-category="Обувь"]').click();
 await page.getByText('Подборки пока не добавлены.').waitFor();
 await page.locator('[data-finds-category="Сумки"]').click();
 await page.getByRole('button',{name:'Смотреть →'}).click();
 assert.equal(await page.getByRole('link',{name:'Открыть товар'}).getAttribute('href'),'https://www.wildberries.ru/catalog/123/detail.aspx');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.getByRole('button',{name:'Сохранено',exact:true}).waitFor();
 await page.locator('#findsBack').click();
 await page.locator('#findsBack').click();
 await page.locator('#openModa').waitFor();
 assert.deepEqual(errors,[]);
 }finally{await browser.close()}
 }
 }finally{server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
