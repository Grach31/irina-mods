// Real app integration: synthetic touch input + controlled network, no production writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const {Window}=await import(process.env.HAPPY_DOM_PATH||'happy-dom');const root=path.join(__dirname,'..');
 const window=new Window({url:'https://grach31.github.io/irina-mods/',settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}}),doc=window.document;
 const html=fs.readFileSync(path.join(root,'miniapp/index.html'),'utf8');let inline=[...html.matchAll(/<script(?: [^>]*)?>(.*?)<\/script>/gs)].map(x=>x[1]).find(x=>x.trim());
 doc.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));Object.defineProperty(doc.documentElement,'clientWidth',{value:390});
 window.__createClient=()=>({auth:{getSession:async()=>({data:{session:{access_token:'eyJ.test.token',user:{id:'9983fe8e-9a69-4ed5-b8ec-f8e056c2f280'}}}})}});
 const calls={},count=k=>calls[k]||0;let offline=false,hold=null;const prefs={push_categories:['oura'],center_categories:['oura'],quiet_start:1320,quiet_end:480};
 window.fetch=async(url,opts={})=>{
  url=String(url);let data,key;
  if(url.includes('/functions/')){
   const b=JSON.parse(opts.body);key=(url.includes('myspace-pwa')?'pwa:':url.includes('myspace-publish')?'publish:':'notices:')+b.action;
   if(key==='pwa:oura_read')data={sleep:{score:80,detail:{}},readiness:{score:81},activity:{score:70},history:[]};
   else if(key.startsWith('pwa:'))data={token:'a'.repeat(64),can_moderate:true};
   else if(key==='publish:list')data={items:[]};
   else if(key==='notices:count')data={unread:0};
   else if(key==='notices:list')data={items:[],more:false,prefs,server_time:new Date().toISOString()};
   else if(key==='notices:preferences')data={prefs,public_key:'A'.repeat(87)};
   else data={ok:true};
  }else{key=url.split('?')[0].split('/').at(-1);data=JSON.parse(fs.readFileSync(path.join(root,'miniapp',key),'utf8'))}
  calls[key]=count(key)+1;if(offline)throw Error('offline');if(hold&&key===hold.key)await hold.promise;
  return {ok:true,status:200,json:async()=>data};
 };
 inline=inline.replace(/import\('https:\/\/esm\.sh\/[^']+'\)/,'Promise.resolve({createClient:window.__createClient})');
 for(const name of ['notifications.js','gestures.js','editorial-publish.js'])window.eval(fs.readFileSync(path.join(root,'miniapp',name),'utf8'));window.eval(inline);
 const settle=async(check,label)=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,5))}throw Error('Timed out: '+label)};
 const click=id=>doc.getElementById(id).click(),get=id=>doc.getElementById(id);
 await settle(()=>doc.querySelector('#list .draft')&&get('pwaBoot').classList.contains('hidden'),'boot');await new Promise(r=>setTimeout(r,20));
 function touch(target,name,x,y){const e=new window.Event(name,{bubbles:true,cancelable:true});const t={clientX:x,clientY:y};Object.defineProperties(e,{touches:{value:name==='touchend'?[]:[t]},changedTouches:{value:[t]}});target.dispatchEvent(e);return e}
 function drag(target,distance=110){touch(target,'touchstart',180,100);touch(target,'touchmove',180,122);const move=touch(target,'touchmove',180,100+distance);touch(target,'touchend',180,100+distance);if(move.defaultPrevented)target.click();return move}
 async function refresh(target,key){const before=count(key);assert.equal(drag(target).defaultPrevented,true);await settle(()=>count(key)>before&&!get('pullIndicator').classList.contains('loading'),'refresh '+key);assert.equal(get('pullMessage').textContent,'Обновлено');assert.equal(count(key),before+1,'one request per pull: '+key)}
 // Full sections and card targets; Moda uses the document, not its unscrollable shell.
 await refresh(get('openModa'),'catalog.json');click('openModa');await new Promise(r=>setTimeout(r,15));
 await refresh(doc.querySelector('#list .draft'),'catalog.json');
 const scroller=doc.scrollingElement||doc.documentElement;scroller.scrollTop=120;const before=count('catalog.json');drag(doc.querySelector('#list .draft'));await new Promise(r=>setTimeout(r,10));assert.equal(count('catalog.json'),before);scroller.scrollTop=0;
 doc.querySelector('#list .draft').click();await settle(()=>get('detail').classList.contains('visible'),'draft');const title=get('detailTitle').textContent;await refresh(get('detailTitle'),'catalog.json');assert.equal(get('detail').classList.contains('visible'),true);assert.equal(get('detailTitle').textContent,title);click('back');click('modaBack');
 click('openOura');await settle(()=>count('pwa:oura_read')>0,'ring');await new Promise(r=>setTimeout(r,10));await refresh(get('ouraSelectedDay'),'pwa:oura_read');click('ouraBack');
 click('openFashion');await settle(()=>doc.querySelector('.fashion-story'),'fashion');
 const artwork=doc.querySelector('.fashion-story .fashion-artwork'),photo=artwork.querySelector('img');assert(photo,'top story has an actual image element');
 photo.dispatchEvent(new window.Event('load'));assert(artwork.classList.contains('has-photo'));assert(artwork.querySelector('small').textContent.includes('Rimowa / ELLE'));
 photo.dispatchEvent(new window.Event('error'));assert.equal(artwork.querySelector('img'),null);assert(!artwork.classList.contains('has-photo'));assert(artwork.querySelector('small').textContent.includes('редакционная обложка'));
 await refresh(doc.querySelector('.fashion-story'),'fashion-daily.json');doc.querySelector('.fashion-story').click();assert(get('fashionArticle').querySelector('.fashion-artwork img'),'article shares the photo renderer');await refresh(get('fashionArticle'),'fashion-daily.json');assert.equal(get('fashionArticle').classList.contains('hidden'),false,'article stays open');click('fashionBack');click('fashionBack');
 for(const [open,type,file] of [['openReels','reels','reels-studio.json'],['openTrends','trends','trend-radar.json'],['openHistory','history','style-time-machine.json']]){
  click(open);await settle(()=>get(type+'Items').querySelector('[data-material-id]'),type);const card=get(type+'Items').querySelector('[data-material-id]');await refresh(card,file);
  offline=true;const content=get(type+'Items').textContent;drag(get(type+'Items'));await settle(()=>!get('pullIndicator').classList.contains('loading'),'offline '+type);assert.equal(get('pullMessage').textContent,'Не удалось обновить');assert.equal(get(type+'Items').textContent,content,'keep cached content');offline=false;click(type+'Back');
 }
 click('openNotifications');await settle(()=>count('notices:list')>0,'notices');await new Promise(r=>setTimeout(r,10));await refresh(get('noticesList'),'notices:list');click('noticesSettings');await settle(()=>get('noticeCategoryPrefs').children.length>0,'preferences');await refresh(get('noticeCategoryPrefs'),'notices:preferences');click('notificationSettingsBack');click('noticesBack');click('openSettings');
 // Local settings must release the refresh lock even without a network await.
 drag(get('settingsAccount'));await settle(()=>!get('pullIndicator').classList.contains('loading'),'local settings');assert.equal(get('pullMessage').textContent,'Обновлено');click('settingsBack');await refresh(get('openModa'),'catalog.json');
 // A slow request blocks duplicate pulls; a navigation hides its old indicator.
 let release;hold={key:'catalog.json',promise:new Promise(r=>release=r)};drag(get('openModa'));await settle(()=>get('pullIndicator').classList.contains('loading'),'slow request');const total=count('catalog.json');drag(get('openModa'));assert.equal(count('catalog.json'),total);click('openOura');assert.equal(get('pullIndicator').classList.contains('shown'),false);release();hold=null;await settle(()=>!get('pullIndicator').classList.contains('loading'),'slow finish');
 console.log('PASS: all six sections, document scrolling, draft/article preservation, notification/settings refresh, cached errors, duplicate prevention and navigation');window.happyDOM.abort();
})().catch(e=>{console.error(e);process.exit(1)});
