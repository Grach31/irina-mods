// Run against a local miniapp server: NODE_PATH=<runtime modules> node tests/notifications-browser.cjs
const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let offline=false;const now=new Date().toISOString(),id='11111111-1111-4111-8111-111111111111';let unread=1;
 const item={id,user_id:'owner',created_at:now,title:'Правки готовы',body:'Подборка обновлена по твоим замечаниям.',category:'edit',targets:[{space:'moda',id:'2026-11-14-mix-knit-and-satin'}],read_at:null};
 const prefs={push_categories:['draft','edit','updates','error'],center_categories:['draft','edit','updates','error','published'],quiet_start:1320,quiet_end:480};
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type'};
 await page.route('**/telegram.org/**',r=>r.fulfill({contentType:'text/javascript',body:''}));
 await page.route('**/vendor/supabase-2.105.0.js',r=>r.fulfill({contentType:'text/javascript',body:`window.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'eyJ.test.token',user:{id:'9983fe8e-9a69-4ed5-b8ec-f8e056c2f280'}}}}),signOut:async()=>({})}}} }`}));
 await page.route('**/functions/v1/myspace-pwa',r=>r.fulfill({headers,json:{token:'a'.repeat(64),can_moderate:true}}));
 await page.route('**/functions/v1/myspace-publish',r=>r.fulfill({headers,json:{items:[]}}));
 await page.route('**/functions/v1/myspace-notifications',async r=>{
  const b=r.request().postDataJSON();if(offline)return r.abort('internetdisconnected');
  let data={ok:true};if(b.action==='count')data={unread};if(b.action==='list')data={items:[item],more:false,prefs,server_time:now};if(b.action==='read'||b.action==='read_all'){unread=0;item.read_at=now}if(b.action==='preferences')data={prefs,public_key:'A'.repeat(87)};
  await r.fulfill({headers,json:data});
 });
 await page.addInitScript(()=>{localStorage.setItem('myspace.theme.v1','dark');localStorage.setItem('myspace.auth.v1','fixture')});
 await page.goto(process.env.MYSPACE_TEST_URL||'http://localhost:8765/');await page.locator('#pwaBoot').waitFor({state:'hidden'});
 await page.locator('#noticeBadge').waitFor({state:'visible',timeout:8000}).catch(async e=>{
  throw new Error(JSON.stringify({login:await page.locator('#pwaLoginStatus').textContent(),errors}),{cause:e});
 });
 const bell=await page.locator('#openNotifications').boundingBox(),gear=await page.locator('#openSettings').boundingBox();assert(bell.x<gear.x);assert.equal(Math.round(bell.y),Math.round(gear.y));
 await page.locator('#openNotifications').click();await page.locator('.ms-notice-row').waitFor();assert.equal(await page.locator('#notificationsSpace').isVisible(),true);
 await page.screenshot({path:require('node:path').join(process.env.NOTICE_QA_DIR||require('node:os').tmpdir(),'notifications-dark.png'),fullPage:true});
 await page.locator('.ms-notice-row').click();await page.locator('#detail.visible').waitFor();assert.equal(unread,0);
 const restored=page.waitForResponse(r=>r.url().endsWith('myspace-notifications')&&r.request().postDataJSON()?.action==='count');
 await page.locator('#back').click();await restored;
 assert.equal(await page.locator('#notificationsSpace').isVisible(),true);assert.equal(await page.locator('#noticeBadge').isVisible(),false);
 offline=true;
 await page.locator('#noticesList').evaluate(target=>{
  for(const [type,y] of [['touchstart',100],['touchmove',130],['touchmove',210],['touchend',210]]){
   const point=new Touch({identifier:1,target,clientX:180,clientY:y});
   target.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[point],changedTouches:[point]}));
  }
 });
 await page.getByText('Не удалось обновить. Показаны ранее загруженные уведомления.').waitFor();
 assert.equal(await page.locator('.ms-notice-row').count(),1);offline=false;
 await page.locator('#noticesSettings').click();await page.locator('#noticeCategoryPrefs input').first().waitFor();assert.equal(await page.locator('#noticeQuietEnd').inputValue(),'08:00');await page.locator('#notificationSettingsBack').click();await page.locator('#noticesBack').click();await page.locator('#openSettings').click();await page.locator('[data-theme-choice="light"]').click();await page.locator('#settingsBack').click();await page.locator('#openNotifications').click();assert.equal(await page.locator('html').getAttribute('data-ms-theme'),'light');
 await page.screenshot({path:require('node:path').join(process.env.NOTICE_QA_DIR||require('node:os').tmpdir(),'notifications-light.png'),fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);assert.equal(overflow,false);assert.deepEqual(errors,[]);
 // Left edge back gesture on the real notification scroller.
 await page.locator('#notificationsSpace').evaluate(element=>{
  const start=new Touch({identifier:1,target:element,clientX:8,clientY:240});
  const end=new Touch({identifier:1,target:element,clientX:160,clientY:245});
  element.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[start]}));
  element.dispatchEvent(new TouchEvent('touchend',{bubbles:true,changedTouches:[end]}));
 });
 assert.equal(await page.locator('#hub').isVisible(),true);
 console.log('PASS: bell placement, center, material/back, read count, offline, settings, themes, mobile layout, swipe; no browser errors');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
