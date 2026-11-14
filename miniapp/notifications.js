/* My Space notification center. No background polling; authenticated API only. */
class MySpaceNotifications {
 constructor({token,showSpace,navigate,login,currentSpace}){
  Object.assign(this,{token,showSpace,navigate,login,currentSpace});this.items=[];this.filter='all';this.pending=[];this.lastCount=0;this.unread=0;this.loaded=false;this.more=false;this.publicKey='';this.serverTime=new Date().toISOString();this.returnTop=0;this.opening=false;
  this.$=id=>document.getElementById(id);this.apiURL='https://rjnfokknhjmtuzturvub.supabase.co/functions/v1/myspace-notifications';
  try{this.device=localStorage.getItem('myspace.notice.device')||crypto.randomUUID();localStorage.setItem('myspace.notice.device',this.device)}catch{this.device=crypto.randomUUID()}
  this.$('openNotifications').onclick=()=>this.showSpace('notifications');this.$('noticesBack').onclick=()=>this.showSpace('hub');
  this.$('noticesSettings').onclick=()=>this.showSpace('notificationSettings');this.$('notificationSettingsBack').onclick=()=>this.showSpace('notifications');
  this.$('openNotificationSettings').onclick=()=>this.showSpace('notificationSettings');
  this.$('noticeTargetsBack').onclick=()=>this.showSpace('notifications');
  this.$('noticesReadAll').onclick=()=>this.readAll();this.$('noticesMore').onclick=()=>this.refresh(true).catch(()=>{});this.$('noticesNew').onclick=()=>this.refresh(false,true).catch(()=>{});
  document.querySelectorAll('[data-notice-filter]').forEach(b=>b.onclick=()=>{this.filter=b.dataset.noticeFilter;this.items=[];this.loaded=false;this.refresh()});
  this.$('noticeEnable').onclick=()=>this.enable();this.$('noticeDisable').onclick=()=>this.disable();this.$('noticeSave').onclick=()=>this.savePrefs();
  navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='myspace-push')this.count(true)});
  window.addEventListener('online',()=>this.resume());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.resume()});
 }
 async api(action,extra={}){const token=await this.token();if(!token){this.login();throw Error('login_required')}
  const r=await fetch(this.apiURL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action,...extra}),cache:'no-store',signal:AbortSignal.timeout(12000)});
  const data=await r.json().catch(()=>({}));if(!r.ok){if(r.status===401)this.login();throw Error(data.error||'request_failed')}return data;
 }
 async ready(){await this.flush();await this.count(true);if(this.currentSpace()==='notifications')await this.refresh();if(this.currentSpace()==='notificationSettings')await this.settings();
  const params=new URLSearchParams(location.search),id=params.get('notice');if(id&&!this.handledLink){this.handledLink=true;try{const {item}=await this.api('get',{id});if(item){await this.open(item,params.get('deliveries')?.split(',')||[])}else{this.showSpace('notifications');this.message('Это уведомление больше недоступно.')}}catch{this.handledLink=false}}
 }
 async resume(){try{await this.flush();if(this.currentSpace()==='notifications')await this.refresh();else await this.count()}catch{}}
 message(text){this.$('noticesMessage').textContent=text}
 async count(force=false){if(this.counting)return this.counting;if(!force&&Date.now()-this.lastCount<30000)return;
  this.counting=(async()=>{try{const d=await this.api('count');this.unread=d.unread;this.lastCount=Date.now();this.badge()}catch{}finally{this.counting=null}})();return this.counting;
 }
 badge(){const b=this.$('noticeBadge');b.hidden=this.unread===0;b.textContent=this.unread>9?'9+':String(this.unread);this.$('openNotifications').setAttribute('aria-label','Уведомления, непрочитанных: '+this.unread);
  if('setAppBadge' in navigator)(this.unread?navigator.setAppBadge(this.unread):navigator.clearAppBadge()).catch(()=>{});
 }
 async refresh(more=false,apply=false){if(this.loading)return this.loading;
  this.loading=(async()=>{try{
   await this.flush();this.message(this.loaded?'':'Загружаю уведомления…');const last=this.items.at(-1);const data=await this.api('list',{unread:this.filter==='unread',cursor:more&&last?{at:last.created_at,id:last.id}:null});
   this.serverTime=data.server_time;this.prefs=data.prefs;this.footer();
   const incoming=data.items;
   if(!more&&!apply&&this.loaded&&this.$('notificationsSpace').scrollTop>80&&incoming.some(x=>!this.items.some(y=>y.id===x.id))){this.$('noticesNew').hidden=false;this.message('');await this.count(true);return}
   this.items=more?[...this.items,...incoming.filter(x=>!this.items.some(y=>y.id===x.id))]:incoming;this.more=data.more;this.loaded=true;this.$('noticesNew').hidden=true;this.render();this.message('');await this.count(true);
  }catch(e){this.message(e.message==='login_required'?'Войди, чтобы открыть уведомления.':this.items.length?'Не удалось обновить. Показаны ранее загруженные уведомления.':'Не удалось загрузить уведомления. Потяни вниз, чтобы повторить.');throw e}
  finally{this.loading=null}})();return this.loading;
 }
 render(){const root=this.$('noticesList'),top=this.$('notificationsSpace').scrollTop;root.replaceChildren();let previous='';
  document.querySelectorAll('[data-notice-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.noticeFilter===this.filter)));
  const visible=this.items.filter(x=>this.filter!=='unread'||!x.read_at);
  if(!visible.length){const e=document.createElement('p');e.className='ms-notice-message';e.textContent=this.filter==='unread'?'Всё прочитано':'Уведомлений пока нет';root.append(e)}
  for(const item of visible){const day=this.day(item.created_at);if(day!==previous){const h=document.createElement('div');h.className='ms-notice-day';h.textContent=day;root.append(h);previous=day}
   const button=document.createElement('button');button.type='button';button.className='ms-notice-row'+(item.read_at?' read':'');
   const dot=document.createElement('span');dot.className='ms-notice-dot';dot.setAttribute('aria-hidden','true');
   const copy=document.createElement('span');copy.className='ms-notice-copy';const meta=document.createElement('span');meta.className='ms-notice-meta';
   const category=document.createElement('span');category.textContent={draft:'MODA',edit:'MODA',updates:'MY SPACE',error:'ВАЖНО',published:'MODA'}[item.category]||'MY SPACE';const time=document.createElement('span');time.textContent=new Date(item.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'});meta.append(category,time);
   const title=document.createElement('strong');title.textContent=item.title;const body=document.createElement('p');body.textContent=item.body;copy.append(meta,title,body);
   const arrow=document.createElement('span');arrow.className='ms-notice-arrow';arrow.textContent='›';arrow.setAttribute('aria-hidden','true');button.append(dot,copy,arrow);button.onclick=()=>this.open(item);root.append(button);
  }
  this.$('noticesMore').hidden=!this.more;this.$('noticesReadAll').disabled=this.unread===0;this.$('notificationsSpace').scrollTop=top;
 }
 day(at){const format=d=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);const d=new Date(at),now=new Date();return format(d)===format(now)?'Сегодня':format(d)===format(new Date(now-86400000))?'Вчера':d.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Moscow'})}
 async open(item,delivery_ids=[]){if(this.opening)return;this.opening=true;this.returnTop=this.$('notificationsSpace').scrollTop;
  try{if(!item.read_at){item.read_at=new Date().toISOString();this.unread=Math.max(0,this.unread-1);this.badge()}
   this.pending.push({action:'read',id:item.id,delivery_ids});await this.flush();
   if(item.targets.length===1)await this.navigate(item.targets[0]);else{this.showSpace('noticeTargets');const root=this.$('noticeTargetsList');root.replaceChildren();for(const t of item.targets){const b=document.createElement('button');b.type='button';b.className='ms-notice-action ms-notice-target';const label={moda:'Moda',fashion:'Fashion Daily',reels:'Reels Studio',history:'Style Time Machine',trends:'Trend Radar'}[t.space]||'Материал';b.textContent=label+' · '+t.id;b.onclick=()=>this.navigate(t);root.append(b)}}
  }catch{this.showSpace('notifications');this.message('Материал временно недоступен. Попробуй открыть его ещё раз.')}finally{this.opening=false}
 }
 async readAll(){const before=this.serverTime;this.items.forEach(x=>{if(x.created_at<=before)x.read_at=new Date().toISOString()});this.unread=0;this.badge();this.render();this.pending.push({action:'read_all',before});await this.flush()}
 async flush(){if(this.flushing)return this.flushing;this.flushing=(async()=>{while(this.pending.length){const x=this.pending[0];try{await this.api(x.action,x);this.pending.shift()}catch{break}}})();try{await this.flushing}finally{this.flushing=null}}
 enter(){if(this.loaded){this.render();requestAnimationFrame(()=>this.$('notificationsSpace').scrollTop=this.returnTop)}this.refresh().catch(()=>{})}
 footer(){const time=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');if(this.prefs)this.$('noticesFooter').textContent=this.prefs.quiet_start===this.prefs.quiet_end?'Тихие часы отключены':'☾ Тихие часы '+time(this.prefs.quiet_start)+'–'+time(this.prefs.quiet_end)+' · Москва'}
 async settings(){try{const d=await this.api('preferences',{device_id:this.device});this.deviceEnabled=d.device_enabled;this.prefs=d.prefs;this.publicKey=d.public_key;const root=this.$('noticeCategoryPrefs');root.replaceChildren();
  for(const [kind,label] of Object.entries({draft:'Готовые черновики',edit:'Выполненные правки',updates:'Общий дайджест обновлений',error:'Важные ошибки',published:'Успешные публикации'})){
   const row=document.createElement('div');row.className='ms-notice-category';const text=document.createElement('span');text.textContent=label;row.append(text);
   for(const channel of ['center','push']){const l=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.dataset.kind=kind;input.dataset.channel=channel;input.checked=this.prefs[channel+'_categories'].includes(kind);input.setAttribute('aria-label',label+': '+(channel==='push'?'push':'в центре'));l.append(input,document.createTextNode(channel==='push'?' Push':' Центр'));row.append(l)}root.append(row)}
  const time=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');this.$('noticeQuietStart').value=time(this.prefs.quiet_start);this.$('noticeQuietEnd').value=time(this.prefs.quiet_end);this.$('noticeSettingsMessage').textContent='';this.footer();await this.permissionStatus();
 }catch{this.$('noticeSettingsMessage').textContent='Не удалось загрузить настройки. Вернись и попробуй ещё раз.'}}
 async permissionStatus(){let text;const supported='Notification' in window&&'PushManager' in window&&'serviceWorker' in navigator;const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  if(ios&&!standalone)text='Добавь My Space на экран «Домой» и открой с его иконки.';else if(!supported)text='Push недоступны в этом окружении. Центр уведомлений работает.';else if(Notification.permission==='denied')text='Push запрещены в iOS. Измени разрешение в настройках уведомлений My Space.';else if(Notification.permission==='granted'){try{const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();text=sub&&this.deviceEnabled!==false?'Включены на этом устройстве':'Отключены на этом устройстве'}catch{text='Не удалось проверить подключение'}}else text='Push пока не включены.';
  this.$('noticePermission').textContent=text;this.$('noticeEnable').disabled=!supported||(ios&&!standalone)||(supported&&Notification.permission==='denied')||!this.publicKey;
 }
 async enable(){// Permission must be requested directly from the user gesture.
  const permissionPromise=Notification.requestPermission();this.$('noticeEnable').disabled=true;
  try{if(await permissionPromise!=='granted'){await this.permissionStatus();return}const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();if(!sub){const raw=atob(this.publicKey.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(this.publicKey.length/4)*4,'='));sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))})}await this.api('subscribe',{device_id:this.device,subscription:sub.toJSON()});this.deviceEnabled=true;await this.permissionStatus();this.$('noticeSettingsMessage').textContent='Уведомления подключены.'}catch{this.$('noticeSettingsMessage').textContent='Не удалось подключить push. Попробуй ещё раз.'}finally{await this.permissionStatus()}
 }
 async disable(){try{await this.api('unsubscribe',{device_id:this.device});this.deviceEnabled=false;const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(sub)await sub.unsubscribe();await this.permissionStatus();this.$('noticeSettingsMessage').textContent='Push отключены на этом устройстве.'}catch{this.$('noticeSettingsMessage').textContent='Не удалось отключить. Проверь соединение и повтори.'}}
 async savePrefs(){const categories=channel=>[...this.$('noticeCategoryPrefs').querySelectorAll('input:checked')].filter(x=>x.dataset.channel===channel).map(x=>x.dataset.kind);const minutes=id=>{const [h,m]=this.$(id).value.split(':').map(Number);return h*60+m};try{const d=await this.api('preferences',{values:{push_categories:categories('push'),center_categories:categories('center'),quiet_start:minutes('noticeQuietStart'),quiet_end:minutes('noticeQuietEnd')}});this.prefs=d.prefs;this.loaded=false;this.items=[];this.footer();await this.count(true);this.$('noticeSettingsMessage').textContent='Настройки сохранены.'}catch{this.$('noticeSettingsMessage').textContent='Не удалось сохранить. Проверь соединение и повтори.'}}
 async logout(){await this.api('unsubscribe',{device_id:this.device});this.items=[];this.loaded=false;this.pending=[];this.unread=0;this.badge();this.$('noticesList').replaceChildren()}
}
window.MySpaceNotifications=MySpaceNotifications;
