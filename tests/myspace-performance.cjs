const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium, webkit, devices} = require('playwright');

const base = process.argv[2] && path.resolve(process.argv[2]);
const current = path.resolve(__dirname, '..');
const owner = '9983fe8e-9a69-4ed5-b8ec-f8e056c2f280';
const cardId = n => '2026-11-27-gcc-' + String(n).repeat(40);
const delay = ms => new Promise(r => setTimeout(r, ms));
const mime = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript',
 '.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const art = fs.readFileSync(path.join(current, 'miniapp/assets/editorial/moda.webp'));
const sdk = fs.readFileSync(path.join(current,'miniapp/vendor/supabase-2.105.0.js'),'utf8');
const baselineSdk = sdk + '\nexport const createClient = supabase.createClient;';
const fixturePhoto = n => fs.readFileSync(path.join(current,'drafts/img',
 ['2026-10-23-looks','2026-10-26-looks','2026-11-01-looks','2026-10-19-looks'][n%4]+(n<4?'':'-2')+'.jpg'));
const fixtures = new Map();
for (const n of [1,2]) {
 const id = cardId(n);
 const photos = Array.from({length:4},(_,i) => fixturePhoto(4*(n-1)+i));
 const keys = photos.map(photo => createHash('sha256').update(photo).digest('hex'));
 const manifest = {id,schema_version:1,mode:'private_preview',publication_allowed:false,rights_verified:false,
  cover_sha256:keys[0],source_archive_sha256:'a'.repeat(64),text:'<b>Private fixture '+n+'</b>\n'+'Text '.repeat(1000),
  items:keys.slice(1).map((photo_sha256,i) => ({photo_sha256,name:'Item '+i,shop:'Shop',url:'https://example.test/'+i,price:1000}))};
 fixtures.set('drafts/'+id, new Map([['manifest.json',Buffer.from(JSON.stringify(manifest))],
  ...keys.map((key,i) => [key+'.jpg',photos[i]])]));
}
const prefs = {center_categories:['oura'],push_categories:['oura'],quiet_start:1320,quiet_end:480};
const notice = {id:'11111111-1111-4111-8111-111111111111',created_at:'2026-11-28T07:00:00Z',category:'draft',
 title:'Test notice',body:'Test body',targets:[{space:'moda',id:cardId(2)}],read_at:null};
const storageHeaders = {'access-control-allow-origin':'*', 'access-control-allow-headers':'*','cache-control':'no-store'};
const format = list => {
 const completed=list.filter(x=>x.bytes!==undefined), count=(rows,key)=>rows.filter(e=>e.key===key).length;
 return {requests:list.length,bodyBytes:completed.reduce((s,x)=>s+x.bytes,0),api:list.filter(x=>x.api).length,
  apiBytes:completed.filter(x=>x.api).reduce((s,x)=>s+x.bytes,0),
  catalog:count(list,'catalog.json'),storage:count(list,'list')+count(list,'manifest')+count(list,'jpeg'),
  jpeg:count(list,'jpeg'),jpegBytes:completed.filter(x=>x.key==='jpeg').reduce((s,x)=>s+x.bytes,0)};
};

async function testSite(browser, engine, root, label, latency, thorough) {
 const rows=[],fault={};
 let modaPending=0,lastModaActivity=0;
 function startModaRequest(){
  modaPending++;lastModaActivity=Date.now();
  return ()=>{modaPending--;lastModaActivity=Date.now()};
 }
 async function waitForModa(){
  const end=Date.now()+17000;
  while(modaPending||Date.now()-lastModaActivity<180){
   if(Date.now()>end)throw Error('Moda requests did not settle');
   await delay(50);
  }
 }
 const server = http.createServer(async (req,res) => {
  const key=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/irina-mods\//,'')||'index.html';
  const row={key,api:key==='catalog.json'};rows.push(row);
  const done=key==='catalog.json'?startModaRequest():null;
  if(done)await delay(latency);
  const file=path.join(root,'miniapp',key);
  const local=fs.existsSync(file)&&fs.statSync(file).isFile();
  const body=local?fs.readFileSync(file):key.startsWith('media/')?art:Buffer.alloc(0);
  const status=local||key.startsWith('media/')?200:404;
  res.writeHead(status,{'Content-Type':mime[path.extname(file)]||(status===200?'image/webp':'text/plain')});
  row.bytes=body.length;res.end(body);done?.();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port+'/irina-mods/';
 const ctx=await browser.newContext({...devices['iPhone 13'],defaultBrowserType:undefined});
 const page=await ctx.newPage();
 page.setDefaultTimeout(18000);
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(({owner, simulatedStandalone})=>{
  if(!localStorage.getItem('perf.seeded')){
   const encode=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
   const exp=Math.floor(Date.now()/1000)+3600;
   const user={id:owner,aud:'authenticated',role:'authenticated',email:'test@example.invalid'};
   const token=encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:owner,exp,role:'authenticated'})+'.dGVzdA';
   localStorage.setItem('myspace.auth.v1',JSON.stringify({user,access_token:token,refresh_token:'fixture',expires_in:3600,expires_at:exp,token_type:'bearer'}));
   localStorage.setItem('perf.seeded','1');
  }
  if(simulatedStandalone)Object.defineProperty(navigator,'standalone',{value:true});
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL),live=new Map();
  URL.createObjectURL=blob=>{const id=create(blob);live.set(id,blob.size);return id};
  URL.revokeObjectURL=id=>{live.delete(id);revoke(id)};
  window.perfBlobStats=()=>[live.size,[...live.values()].reduce((a,b)=>a+b,0)];
 },{owner,simulatedStandalone:engine==='webkit'});
 let storageInFlight=0, maxStorage=0;
 await page.route('https://**/*',async route=>{
  const request=route.request(),u=new URL(request.url());
  const respond=async(key,body,type='application/json',status=200,api=false)=>{
   if(!Buffer.isBuffer(body))body=Buffer.from(typeof body==='string'?body:JSON.stringify(body));
   const row={key,api};rows.push(row);
   const storage=['jpeg','manifest','list'].includes(key);
   const done=storage||key==='myspace-publish:list'?startModaRequest():null;
   if(storage){storageInFlight++;maxStorage=Math.max(maxStorage,storageInFlight)}
   try{
    if(api)await delay(latency+(latency>100?Math.round(body.length/262.144):0));
    if(fault[key]==='hang')return; // Interception keeps the request open until the client aborts it.
    if(fault[key]){
     status=503;body=Buffer.from('{"error":"simulated_outage"}');type='application/json';
    }
    await route.fulfill({status,contentType:type,body,headers:storageHeaders});
    row.bytes=body.length;
   }catch(e){if(!/closed|interception/i.test(String(e)))throw e}
   finally{if(storage)storageInFlight--;done?.()}
  };
  if(u.hostname==='esm.sh'){await delay(latency);return respond('cdn-sdk',baselineSdk,'text/javascript')}
  if(u.hostname==='telegram.org'){await delay(latency);return respond('telegram-sdk','','text/javascript')}
  if(!u.hostname.endsWith('.supabase.co'))return respond('external-image',art,'image/webp');
  const payload=request.postDataJSON()||{};
  if(u.pathname.startsWith('/storage/v1/object/list/')){
   return respond('list',payload.prefix==='drafts'?
    [...fixtures.keys()].reverse().map(key=>({name:key.split('/').at(-1)})):
    [...(fixtures.get(payload.prefix)||[])].map(([name,bytes])=>({name,id:name,updated_at:'2026-11-27T18:00:00Z',metadata:{size:bytes.length,eTag:name}})),
    'application/json',200,true);
  }
  if(u.pathname.startsWith('/storage/v1/object/')){
   const parts=u.pathname.split('/'),name=parts.at(-1),folder=parts.slice(-3,-1).join('/');
   const data=fixtures.get(folder)?.get(name);
   return respond(name.endsWith('.jpg')?'jpeg':'manifest',data||{},name.endsWith('.jpg')?'image/jpeg':'application/json',data?200:404,true);
  }
  if(u.pathname.startsWith('/auth/v1/'))return respond('sdk-auth',{},'application/json',200,true);
  const key=u.pathname.split('/').at(-1)+':'+payload.action;
  if(payload.action==='session_exchange'&&(!payload.access_token?.startsWith('eyJ')))return respond(key,{},'application/json',401,true);
  const data={session_exchange:{token:'a'.repeat(64),can_moderate:true},oura_read:{sleep:{score:80},readiness:{score:81},activity:{score:72},history:[]},
   count:{unread:1},preferences:{prefs,public_key:'A'.repeat(87)},unsubscribe:{ok:true},signout:{ok:true},
   editorial_list:{items:[]}}[payload.action]||{items:u.pathname.endsWith('notifications')?[notice]:[],prefs,more:false,server_time:new Date().toISOString()};
  assert(!['publish','editorial_publish'].includes(payload.action),'Fixture must never publish');
  return respond(key,data,'application/json',200,true);
 });
 const click=id=>page.locator('#'+id).click();
 const visible=selector=>page.locator(selector).first().waitFor({state:'visible'});
 const touchPull=async (selector,scrollAfter=0)=>{
  await page.locator(selector).first().evaluate((target,scrollAfter)=>{
   const scroller=target.closest('#detail,.fashion-space,.myspace-space')||document.scrollingElement;
   scroller.scrollTop=0;
   for(const [type,y] of [['touchstart',100],['touchmove',125],['touchmove',210],['touchend',210]]){
    const event=new Event(type,{bubbles:true,cancelable:true});
    Object.defineProperties(event,{touches:{value:type==='touchend'?[]:[{clientX:180,clientY:y}]},changedTouches:{value:[{clientX:180,clientY:y}]}});
    target.dispatchEvent(event);
   }
   if(scrollAfter)scroller.scrollTop=scrollAfter;
  },scrollAfter);
  await page.waitForFunction(()=>!document.querySelector('#pullIndicator').classList.contains('loading'));
 };
 const heap=engine==='chromium'?await ctx.newCDPSession(page):null;
 async function memory(){
  if(heap)await heap.send('HeapProfiler.collectGarbage');
  const h=heap&&await heap.send('Runtime.getHeapUsage');
  const [blobUrls,blobBytes]=await page.evaluate(()=>window.perfBlobStats());
  return {jsHeap:h?.usedSize??null,blobUrls,blobBytes};
 }
 const ready=()=>page.waitForFunction(()=>document.querySelector('#pwaBoot').classList.contains('hidden')&&
  document.querySelector('#pwaGate').classList.contains('hidden'));
 try{
  let start=Date.now();
  await page.goto(url,{waitUntil:'domcontentloaded'});await ready();
  const coldMs=Date.now()-start;
  await delay(latency+200);
  const cold={ms:coldMs,...format(rows),...await memory()};
  const startModa=rows.length;
  start=Date.now();await click('openModa');
  const card=page.getByRole('button',{name:/Private fixture 2/});
  await card.waitFor();
  const modaMs=Date.now()-start;
  await card.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>[...document.querySelectorAll('#list .draft')].find(x=>x.textContent.includes('Private fixture 2'))?.querySelector('img')?.naturalWidth>0);
  await waitForModa();
  const moda={ms:modaMs,...format(rows.slice(startModa)),...await memory()};
  await card.click();
  await visible('#detail.visible');
  await click('galleryNext');
  await page.waitForFunction(()=>document.querySelectorAll('#galleryDots .selected')[0]?.getAttribute('aria-label')?.startsWith('Фото 2'));
  const second=page.locator('#gallery .slide img').nth(1);
  await page.waitForFunction(()=>document.querySelectorAll('#gallery .slide img')[1]?.naturalWidth>0);
  assert(await second.isVisible());
  await page.evaluate(()=>{window.perfCard=[...document.querySelectorAll('#list .draft')].find(x=>x.textContent.includes('Private fixture 2'))});
  let mark=rows.length;
  await touchPull('#detailTitle',180);await waitForModa();
  const refresh={...format(rows.slice(mark)),...await memory(),state:await page.evaluate(()=>({
   detail:document.querySelector('#detail').classList.contains('visible'),
   scroll:document.querySelector('#detail').scrollTop,
   carousel:document.querySelector('#galleryDots .selected')?.getAttribute('aria-label'),
   sameCard:window.perfCard?.isConnected,
   title:document.querySelector('#detailTitle').textContent,
  }))};
  if(label==='after'){
   assert.equal(cold.storage,0);assert.equal(cold.catalog,0);
   assert.equal(refresh.jpeg,0);assert.equal(refresh.catalog,1);
   assert.equal(refresh.state.detail,true);assert.equal(refresh.state.sameCard,true);
   assert.equal(refresh.state.scroll,180);
   assert.match(refresh.state.carousel,/Фото 2/);assert(maxStorage<=3);
  }
  if(label==='after'&&thorough){
   fault['myspace-publish:list']=true;fault.list=true;
   const count=await page.locator('#pending').textContent();
   await touchPull('#detailTitle');
   assert.equal(await page.locator('#pending').textContent(),count);
   assert.match(await page.locator('#pullMessage').textContent(),/Не удалось/);
   assert(await page.locator('#detail').isVisible());
   delete fault['myspace-publish:list'];delete fault.list;
  }
  if(await page.locator('#detail').isVisible())await click('back');
  await click('modaBack');
  mark=rows.length;start=Date.now();
  await page.reload({waitUntil:'domcontentloaded'});await ready();
  const reopenMs=Date.now()-start;
  await delay(latency+200);
  const reopen={ms:reopenMs,...format(rows.slice(mark)),...await memory()};
  let coverage, outageMs;
  if(label==='after'&&thorough){
   for(const [open,selector,back] of [
    ['openFashion','.fashion-story','fashionBack'],['openTrends','#trendsItems [data-material-id]','trendsBack'],
    ['openReels','#reelsItems [data-material-id]','reelsBack'],['openHistory','#historyItems [data-material-id]','historyBack'],
    ['openFinds','#findsContent .finds-card','findsBack'],['openOura','#ouraSleep','ouraBack'],
    ['openNotifications','.ms-notice-row','noticesBack'],['openSettings','#settingsAccount','settingsBack'],
   ]){
    await click(open);await visible(selector);await click(back);
   }
   await click('openSettings');await click('openNotificationSettings');await visible('#noticeCategoryPrefs input');
   await click('notificationSettingsBack');await click('noticesBack');
   await click('openModa');await card.waitFor();await card.scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>window.perfBlobStats()[0]>0);
   await click('modaBack');
   await page.waitForFunction(()=>window.perfBlobStats()[0]===0);
   await click('openSettings');fault['myspace-notifications:unsubscribe']=true;await click('settingsLogout');
   await visible('#pwaGate');await page.waitForFunction(()=>!localStorage.getItem('myspace.auth.v1'));
   assert.deepEqual(await page.evaluate(()=>window.perfBlobStats()),[0,0]);
   mark=rows.length;await page.reload();await visible('#pwaGate');
   assert(!rows.slice(mark).some(x=>x.key.includes('supabase-2.105.0')||x.key==='catalog.json'||x.api));
   assert.deepEqual(errors,[]);
   coverage='all nine screens, touch reload, navigation, logout during outage, SW and empty Cache Storage';
   await page.evaluate(()=>{localStorage.removeItem('perf.seeded');localStorage.removeItem('myspace.auth.logging-out')});
   fault['myspace-pwa:session_exchange']='hang';
   start=Date.now();await page.reload({waitUntil:'domcontentloaded'});await visible('#pwaGate');outageMs=Date.now()-start;
   assert(outageMs<14500);assert.match(await page.locator('#pwaLoginStatus').textContent(),/Не удалось проверить/);
   // Loopback is a secure context, but the app registers automatically only on HTTPS.
   const registration=await page.evaluate(async()=>{
    await navigator.serviceWorker.register('sw.js',{updateViaCache:'none'});
    return (await navigator.serviceWorker.ready).scope;
   });
   assert.equal(registration,url);
   assert.deepEqual(await page.evaluate(()=>caches.keys()),[]);
  }
  return {engine,label,latency,cold,moda,refresh,reopen,maxStorage,coverage,outageMs};
 } catch(error){
  console.error(engine,label,latency,await page.evaluate(()=>({
   boot:document.querySelector('#pwaBoot')?.className,gate:document.querySelector('#pwaGate')?.className,
   moda:document.querySelector('#list')?.textContent.slice(0,260),secure:isSecureContext,subtle:!!crypto.subtle,
   pull:document.querySelector('#pullMessage')?.textContent,
  })).catch(()=>null),errors,rows.filter(x=>x.api).slice(-20));
  throw error;
 } finally{
  await ctx.close();
  server.closeAllConnections();
  await new Promise(r=>server.close(r));
 }
}

(async()=>{
 const engines=process.env.MYSPACE_ENGINES?.split(',')||['chromium','webkit'];
 const passes=Number(process.env.MYSPACE_PASSES||3);
 for(const engine of engines){
  const browser=await (engine==='chromium'?chromium.launch({channel:'chrome'}):webkit.launch());
  try{
   for(const latency of [90,450]){
    for(let run=0;run<passes;run++){
     if(base)console.log(JSON.stringify(await testSite(browser,engine,base,'before',latency,false)));
     console.log(JSON.stringify(await testSite(browser,engine,current,'after',latency,latency===90&&run===0)));
    }
   }
  } finally{await browser.close()}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
