/* Sensitive responses are never cached. Push always produces a visible notification. */
self.addEventListener('install',event=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>event.waitUntil((async()=>{
 let data={};try{data=event.data?.json()||{}}catch{}
 const root=new URL('./',self.location.href);
 let target=new URL('?space=notifications',root);
 try{const candidate=new URL(data.url||'?space=notifications',root);if(candidate.origin===root.origin&&candidate.pathname===root.pathname)target=candidate}catch{}
 if(Array.isArray(data.delivery_ids))target.searchParams.set('deliveries',data.delivery_ids.slice(0,50).join(','));
 await self.registration.showNotification(String(data.title||'My Space'),{body:String(data.body||'Есть новые уведомления.'),icon:new URL('icon-192.png',root).href,badge:new URL('icon-192.png',root).href,tag:String(data.tag||'myspace'),data:{url:target.href},renotify:false});
 if('setAppBadge' in navigator&&Number.isInteger(data.unread))await navigator.setAppBadge(data.unread).catch(()=>{});
 const pages=await self.clients.matchAll({type:'window',includeUncontrolled:true});pages.forEach(c=>c.postMessage({type:'myspace-push'}));
})()));
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{
 const root=new URL('./',self.location.href);let url=new URL('?space=notifications',root);
 try{const candidate=new URL(event.notification.data?.url);if(candidate.origin===root.origin&&candidate.pathname===root.pathname)url=candidate}catch{}
 const pages=await self.clients.matchAll({type:'window',includeUncontrolled:true});const existing=pages.find(x=>x.url.startsWith(root.href));
 if(existing){await existing.navigate(url.href);await existing.focus()}else await self.clients.openWindow(url.href);
})())});
