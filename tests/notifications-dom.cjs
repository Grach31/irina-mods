// Optional DOM integration test: HAPPY_DOM_PATH=/path/to/happy-dom/lib/index.js node tests/notifications-dom.cjs
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const {Window}=await import(process.env.HAPPY_DOM_PATH||'happy-dom');const root=path.join(__dirname,'..');
 const window=new Window({url:'https://grach31.github.io/irina-mods/',settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});const doc=window.document;
 let html=fs.readFileSync(path.join(root,'miniapp/index.html'),'utf8'),inline=[...html.matchAll(/<script(?: [^>]*)?>(.*?)<\/script>/gs)].map(x=>x[1]).filter(x=>x.trim())[0];
 doc.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));
 const token='eyJ.mock.token',uid='9983fe8e-9a69-4ed5-b8ec-f8e056c2f280';window.__createClient=()=>({auth:{getSession:async()=>({data:{session:{access_token:token,user:{id:uid}}}}),signOut:async()=>({})}});
 window.localStorage.setItem('myspace.theme.v1','dark');
 let unread=1,offline=false;const now=new Date().toISOString();const row={id:'11111111-1111-4111-8111-111111111111',created_at:now,title:'Правки готовы',body:'Подборка обновлена.',category:'edit',targets:[{space:'moda',id:'2026-11-14-mix-knit-and-satin'}],read_at:null};
 const prefs={push_categories:['draft','edit','updates','error'],center_categories:['draft','edit','updates','error','published'],quiet_start:1320,quiet_end:480};
 window.fetch=async(url,options={})=>{
  url=String(url);let value;
  if(url.includes('/myspace-notifications')){if(offline)throw Error('offline');const b=JSON.parse(options.body);value={ok:true};if(b.action==='count')value={unread};if(b.action==='list')value={items:[{...row}],more:false,prefs,server_time:now};if(b.action==='preferences')value={prefs,public_key:'A'.repeat(87)};if(['read','read_all'].includes(b.action)){row.read_at=now;unread=0}}
  else if(url.includes('/myspace-pwa')){const b=JSON.parse(options.body);value=b.action==='oura_read'?{sleep:{score:80,detail:{}},readiness:{score:80},activity:{score:70},history:[]}:{token:'a'.repeat(64),can_moderate:true}}else if(url.includes('/myspace-publish'))value={items:[]};
  else {const filename=url.split('?')[0].split('/').at(-1);value=JSON.parse(fs.readFileSync(path.join(root,'miniapp',filename),'utf8'))}
  return {ok:true,status:200,json:async()=>value};
 };
 inline=inline.replace(/import\('https:\/\/esm\.sh\/[^']+'\)/,'Promise.resolve({createClient:window.__createClient})');
 window.eval(fs.readFileSync(path.join(root,'miniapp/notifications.js'),'utf8'));window.eval(inline);
 const settle=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,10))}throw Error('DOM condition timed out')};
 await settle(()=>!doc.getElementById('noticeBadge').hidden);
 const click=id=>doc.getElementById(id).click();click('openNotifications');await settle(()=>doc.querySelector('.ms-notice-row'));
 assert.equal(doc.getElementById('notificationsSpace').classList.contains('hidden'),false);assert.equal(doc.documentElement.dataset.msTheme,'dark');
 doc.querySelector('.ms-notice-row').click();await settle(()=>doc.getElementById('detail').classList.contains('visible'));assert.equal(unread,0);click('back');assert.equal(doc.getElementById('notificationsSpace').classList.contains('hidden'),false);
 await settle(()=>doc.querySelector('.ms-notice-row.read'));assert.equal(doc.getElementById('noticeBadge').hidden,true);
 // A ring notice uses the real app router, fetches saved metrics, and returns to the center.
 Object.assign(row,{category:'oura',title:'Данные Oura обновлены',targets:[{space:'oura',id:'2026-11-14'}]});
 doc.getElementById('noticesNew').click();await settle(()=>doc.querySelector('.ms-notice-meta')?.textContent.includes('OURA RING'));
 doc.querySelector('.ms-notice-row').click();await settle(()=>!doc.getElementById('ouraSpace').classList.contains('hidden'));
 click('ouraBack');assert.equal(doc.getElementById('notificationsSpace').classList.contains('hidden'),false);
 click('noticesSettings');await settle(()=>doc.querySelector('#noticeCategoryPrefs input'));assert.equal(doc.querySelectorAll('#noticeCategoryPrefs input[data-kind="oura"]').length,2);assert.equal(doc.getElementById('noticeQuietEnd').value,'08:00');click('notificationSettingsBack');click('noticesBack');click('openSettings');doc.querySelector('[data-theme-choice="light"]').click();click('settingsBack');click('openNotifications');assert.equal(doc.documentElement.dataset.msTheme,'light');
 await new Promise(r=>setTimeout(r,50));offline=true;doc.getElementById('noticesNew').hidden=false;click('noticesNew');await settle(()=>doc.getElementById('noticesMessage').textContent.includes('Не удалось обновить'));assert.equal(doc.querySelectorAll('.ms-notice-row').length,1);
 console.log('PASS: actual app initialization, bell, center, material link/back, read sync, settings, dark/light themes, offline list');window.happyDOM.abort();
})().catch(e=>{console.error(e);process.exit(1)});
