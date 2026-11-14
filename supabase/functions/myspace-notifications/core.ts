export const SPACES = new Set(['moda','fashion','reels','history','trends']);
export function validSubscription(s: any) {
  try {
    const u=new URL(s.endpoint);
    // Strict allowlist prevents authenticated SSRF against internal or arbitrary hosts.
    const allowed=u.hostname.endsWith('.push.apple.com') || u.hostname==='fcm.googleapis.com' || u.hostname==='updates.push.services.mozilla.com' || u.hostname.endsWith('.notify.windows.com');
    return allowed && u.protocol==='https:' && !u.port && !u.username && !u.password && s.endpoint.length<2048 && /^[\w-]{80,100}$/.test(s.keys?.p256dh||'') && /^[\w-]{20,30}$/.test(s.keys?.auth||'');
  } catch {return false}
}
export function safeTarget(t: any) {return SPACES.has(t?.space) && typeof t?.id==='string' && t.id.length<=200}
export function groupJobs(jobs: any[]) {
  const groups=new Map<string,any[]>();
  for(const job of jobs){const key=job.subscription_id;groups.set(key,[...(groups.get(key)||[]),job])}return [...groups.values()];
}
export function notificationPayload(jobs:any[], unread:number) {
  const first=jobs[0].notification;
  return {title:jobs.length>1?'Новое в My Space':first.title,body:jobs.length>1?'Есть новые уведомления. Открой My Space.':first.body,
    tag:jobs.length===1?first.id:'myspace-summary-'+new Date().toISOString().slice(0,10),
    notification_id:jobs.length===1?first.id:null,delivery_ids:jobs.map(x=>x.id),unread,
    url:jobs.length===1?'?space=notifications&notice='+encodeURIComponent(first.id):'?space=notifications'};
}
