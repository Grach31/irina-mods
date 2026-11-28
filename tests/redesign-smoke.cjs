const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../miniapp');
const output = process.env.REDESIGN_QA_DIR;
const base = '/irina-mods/';
const skus = [900001, 900002, 900003, 900004];
const images = ['bag', 'shoes', 'jewelry', 'moda'].map(name => 'https://fixture.invalid/' + name + '.webp');
// Isolated browser fixtures only. Nothing in this file is exported to Pages.
const products = ['Сумка-багет из мягкой экокожи', 'Туфли-слингбэки с ремешком',
  'Колье с подвеской «Клевер»', 'Платье из хлопка'].map((title, index) => ({
  id: 'wb-' + skus[index], title, category: ['Сумки', 'Обувь', 'Бижутерия', 'Одежда'][index],
  wb_article: String(skus[index]), price: [2390,2790,1190,3490][index],
  description: 'Мягкая форма и лаконичная отделка. Подойдёт для повседневных образов.',
  stylist: 'Сочетай с кремовым жакетом и украшениями тёплого оттенка.',
  material: 'Экокожа', color: 'Молочный', style: 'Минимализм',
  url: 'https://www.wildberries.ru/catalog/' + skus[index] + '/detail.aspx',
  photos: [{url:images[index],alt:title},{url:images[(index+1)%images.length],alt:'Второй ракурс'}],
}));
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const fallbackArt = fs.readFileSync(path.join(root, 'assets/editorial/fashion.webp'));
const server = http.createServer((req, res) => {
  const relative = new URL(req.url, 'http://localhost').pathname.replace(/^\/irina-mods\//, '') || 'index.html';
  const file = path.resolve(root, relative);
  if (file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  } else if (relative.startsWith('media/')) {
    res.setHeader('Content-Type','image/webp'); res.end(fallbackArt);
  } else {
    res.writeHead(404); res.end();
  }
});

const content = id => ({
  id, title: 'Проверка макета', text: 'Технический пример для браузерного теста.',
  type:'picks', ready:true, revision:'a'.repeat(64), image:'media/fixture.webp',
  meta:{status:'queued',created_at:'2026-11-25',image:'media/fixture.webp'},
});
const notice = {
  id:'11111111-1111-4111-8111-111111111111', created_at:'2026-11-25T06:00:00Z',
  title:'Подборка готова', body:'Тестовое уведомление редакции.', category:'draft',
  targets:[{space:'moda',id:'fixture'}], read_at:null,
};
const prefs = {push_categories:['draft'], center_categories:['draft'], quiet_start:1320, quiet_end:480};
const isImage = extension => /\.(jpg|jpeg|png|webp|avif)(?:\?|$)/i.test(extension);
function touch(page, selector, type, point) {
  return page.locator(selector).evaluate((element, {type, point}) => {
    const event = new Event(type,{bubbles:true,cancelable:true});
    Object.defineProperties(event,{
      touches:{value:type==='touchend'?[]:[point]},
      changedTouches:{value:[point]},
    });
    element.dispatchEvent(event);
  },{type,point});
}
async function screenshot(page, engine, width, name) {
  if (!output || width !== 390) return;
  const target = path.join(output,engine);
  fs.mkdirSync(target,{recursive:true});
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({path:path.join(target,name+'.png'),animations:'disabled'});
}
async function verify(engine, browser, width) {
  const page = await browser.newPage({viewport:{width,height:{375:812,390:844,393:852,430:932}[width]},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  page.setDefaultTimeout(8500);
  const errors = [], publish = [];
  let authenticated = true, findsReads = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/vendor/supabase-2.105.0.js', route=>route.fulfill({
      contentType:'text/javascript',
      body:`window.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:${authenticated ?
        JSON.stringify({access_token:'test-session',user:{id:'9983fe8e-9a69-4ed5-b8ec-f8e056c2f280'}}) : 'null'}}}),signOut:async()=>({})}}} }`,
  }));
  await page.addInitScript(()=>localStorage.setItem('myspace.auth.v1','fixture'));
  await page.route('https://**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname==='telegram.org') return route.fulfill({contentType:'text/javascript',body:''});
    if (url.hostname==='fixture.invalid') return route.fulfill({path:path.join(root,'assets/editorial',path.basename(url.pathname))});
    if (url.pathname.endsWith('/myspace-pwa')) {
      const action=route.request().postDataJSON().action;
      return route.fulfill({json:action==='oura_read'?
        {sleep:{score:82},readiness:{score:81},activity:{score:74},history:[],updated_at:new Date().toISOString()}:
        {token:'a'.repeat(64),can_moderate:true}});
    }
    if (url.pathname.endsWith('/myspace-publish')) {
      const data=route.request().postDataJSON();
      publish.push(data.action);
      if (data.action==='editorial_preview') return route.fulfill({json:{status:'draft',revision:'b'.repeat(64),parts:[
        {kind:'media',photos:images.slice(0,2),html:'<b>Тестовый предпросмотр</b>'}],text:'Фикстура'}});
      // This browser test exercises confirmation UI only. A send is a test failure.
      if (data.action==='editorial_publish') return route.fulfill({status:400,json:{error:'send_forbidden_in_test'}});
      return route.fulfill({json:{items:[]}});
    }
    if (url.pathname.endsWith('/myspace-notifications')) {
      const action=route.request().postDataJSON().action;
      return route.fulfill({json:action==='count'?{unread:1}:action==='list'?{
        items:[notice],prefs,server_time:new Date().toISOString(),more:false}:{prefs,ok:true}});
    }
    if (isImage(url.pathname)) return route.fulfill({body:fallbackArt,contentType:'image/webp'});
    return route.abort();
  });
  await page.route('**/catalog.json*', route => route.fulfill({json:{items:[content('fixture')]}}));
  await page.route('**/china-finds.json*', route => {
    findsReads++;
    return route.fulfill({json:{schema_version:1,items:products}});
  });
  const app = 'http://127.0.0.1:'+server.address().port+base;
  await page.goto(app);
  await page.locator('#pwaBoot').waitFor({state:'hidden'});
  assert.equal(await page.locator('#pwaGate').isVisible(), false);
  assert.deepEqual(await page.locator('.hub-card').evaluateAll(cards=>cards.map(x=>x.id)),
    ['openModa','openFinds','openOura','openFashion','openTrends','openReels','openHistory']);
  await page.locator('.hub-card img').evaluateAll(imgs => imgs.forEach(img => {img.loading='eager'}));
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.hub-card img')).every(img=>img.naturalWidth>0));
  const heading=await page.locator('.hub-logo').boundingBox(), bell=await page.locator('#openNotifications').boundingBox();
  assert(heading.x+heading.width<bell.x,'Notification control overlaps the wordmark');
  await screenshot(page,engine,width,'01-home');
  await page.locator('#openHistory').scrollIntoViewIfNeeded();
  await page.locator('#hub').evaluate(el=>{el.scrollTop=el.scrollHeight});
  const last = await page.locator('#openHistory').boundingBox();
  assert.equal(await page.locator('#editorialNav').count(),0);
  assert(last.y+last.height<=page.viewportSize().height,'Final dashboard section remains below the viewport');
  await screenshot(page,engine,width,'02-home-scroll');
  await page.locator('#openFinds').click();
  await page.getByText(products[0].title,{exact:true}).waitFor();
  await screenshot(page,engine,width,'03-finds');
  await page.locator('[data-finds-category="Обувь"]').click();
  assert.equal(await page.locator('.finds-card').count(),1);
  await page.locator('[data-finds-category="Сумки"]').click();
  await page.getByRole('button',{name:'Смотреть →'}).click();
  const direct=page.getByRole('link',{name:'Открыть на Wildberries'});
  assert.equal(await direct.getAttribute('href'),products[0].url);
  await page.locator('.finds-product .finds-photos').evaluate(el=>{el.scrollLeft=el.clientWidth});
  await page.waitForFunction(()=>document.querySelector('.finds-product .finds-photos').scrollLeft>0);
  await page.waitForFunction(()=>document.querySelector('.finds-product .finds-slide:nth-child(2) img').naturalWidth>0);
  await page.locator('.finds-product .finds-photo-dot').first().click();
  await page.waitForFunction(()=>document.querySelector('.finds-product .finds-photos').scrollLeft===0);
  const publishButton=page.getByRole('button',{name:'Опубликовать в Telegram',exact:true});
  assert.equal(await page.locator('.finds-actions').evaluate(el=>getComputedStyle(el).position),'static');
  assert((await direct.boundingBox()).y < (await publishButton.boundingBox()).y);
  await screenshot(page,engine,width,'04-product');
  await page.getByRole('button',{name:'В избранное',exact:true}).click();
  const saved=page.getByRole('button',{name:'Убрать из избранного',exact:true});
  assert.equal(await saved.getAttribute('aria-pressed'),'true');
  await publishButton.click();
  await page.getByText('Тестовый предпросмотр').waitFor();
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  assert(publish.includes('editorial_preview')&&!publish.includes('editorial_publish'));
  await touch(page,'#findsSpace','touchstart',{clientX:5,clientY:190});
  await touch(page,'#findsSpace','touchend',{clientX:170,clientY:190});
  await page.locator('.finds-card').waitFor();
  await page.locator('#findsSaved').click();
  assert.equal(await page.locator('.finds-card').count(),1);
  await page.reload();
  await page.locator('#pwaBoot').waitFor({state:'hidden'});
  await page.locator('#findsSaved').click();
  await page.locator('.finds-card').waitFor();
  await page.locator('#findsSaved').click();
  await page.locator('#findsSearch').fill('900003');
  assert.equal(await page.locator('.finds-card').count(),1);
  await page.locator('#findsSearch').fill('');
  const reads = findsReads;
  await touch(page,'#findsSpace','touchstart',{clientX:200,clientY:30});
  await touch(page,'#findsSpace','touchmove',{clientX:203,clientY:161});
  await touch(page,'#findsSpace','touchend',{clientX:203,clientY:161});
  await page.waitForFunction(()=>!document.querySelector('#pullIndicator').classList.contains('loading'));
  assert(findsReads>reads,'Pull-to-refresh did not fetch the finds feed');
  await page.locator('#findsBack').click();
  for (const [entry, section, back, image] of [
    ['Moda','modaShell','modaBack','05-moda'],['Oura','ouraSpace','ouraBack','07-oura'],
    ['Fashion','fashionSpace','fashionBack','08-fashion'],['Trends','trendsSpace','trendsBack','10-trend'],
    ['Reels','reelsSpace','reelsBack','11-reels'],['History','historySpace','historyBack','12-history'],
    ['Notifications','notificationsSpace','noticesBack','13-notifications'],
    ['Settings','settingsSpace','settingsBack','14-settings'],
  ]) {
    await page.locator('#open'+entry).click();
    await page.locator('#'+section).waitFor();
    if(entry==='Notifications')await page.getByText(notice.title).waitFor();
    if(entry==='Moda')await page.locator('.draft').first().waitFor();
    if(entry==='Fashion')await page.locator('.fashion-story').first().waitFor();
    const overflow=await page.locator('#'+section).evaluate(el=>el.scrollWidth>el.clientWidth+1);
    assert.equal(overflow,false,section+' exceeds its visible width');
    await screenshot(page,engine,width,image);
    if(entry==='Moda'){
      await page.locator('.draft').first().click();
      await page.locator('#detail.visible').waitFor();
      await screenshot(page,engine,width,'06-moda-detail');await page.locator('#back').click();
    }
    if(entry==='Fashion'){
      await page.locator('.fashion-story').first().click();
      await page.locator('#fashionArticle').waitFor();
      await screenshot(page,engine,width,'09-fashion-detail');await page.locator('#fashionBack').click();
    }
    await page.locator('#'+back).click();
    await page.locator('#hub').waitFor();
  }
  await page.locator('#openSettings').click();
  await page.locator('[data-theme-choice="dark"]').click();
  await page.locator('#settingsBack').click();
  assert.equal(await page.locator('html').getAttribute('data-ms-theme'),'dark');
  await screenshot(page,engine,width,'15-home-dark');
  await page.locator('#openFinds').click();
  await page.locator('.finds-card').first().waitFor();
  await screenshot(page,engine,width,'16-finds-dark');
  const manifest=await page.request.get(app+'manifest.webmanifest');
  assert.equal((await manifest.json()).display,'standalone');
  authenticated=false;
  await page.goto(app);
  await page.locator('#pwaGate').waitFor();
  await screenshot(page,engine,width,'17-login-dark');
  assert.deepEqual(errors,[]);
  await page.close();
  console.log(engine,width,'OK');
}

(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    for (const [name, engine] of Object.entries({chromium,webkit})) {
      if (process.env.REDESIGN_ENGINE && process.env.REDESIGN_ENGINE!==name) continue;
      const browser = await engine.launch(name==='chromium'&&process.env.CHROMIUM_PATH?
        {executablePath:process.env.CHROMIUM_PATH}:{});
      try {
        for (const width of [375,390,393,430]) {
          if (!process.env.REDESIGN_WIDTH || Number(process.env.REDESIGN_WIDTH)===width) await verify(name,browser,width);
        }
      } finally { await browser.close(); }
    }
  } finally { server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
