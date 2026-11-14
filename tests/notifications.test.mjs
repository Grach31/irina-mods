import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validSubscription,safeTarget,groupJobs,notificationPayload,CATEGORIES} from '../supabase/functions/myspace-notifications/core.ts';
test('push endpoints reject SSRF, credentials, ports and invalid keys',()=>{
 const subscription={endpoint:'https://web.push.apple.com/QH/test',keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}};
 assert.equal(validSubscription(subscription),true);
 for(const endpoint of ['http://web.push.apple.com/x','https://evil.test/x','https://web.push.apple.com.evil.test/x','https://127.0.0.1/x','https://web.push.apple.com:8443/x','https://a:b@web.push.apple.com/x'])assert.equal(validSubscription({...subscription,endpoint}),false,endpoint);
 assert.equal(validSubscription({...subscription,keys:{auth:'bad'}}),false);
});
test('deep links allow only existing content sections',()=>{
 assert.equal(safeTarget({space:'moda',id:'draft-id'}),true);
 assert.equal(safeTarget({space:'https://evil.test',id:'x'}),false);
 assert.equal(safeTarget({space:'oura',id:'2026-11-14'}),true);
 assert.equal(safeTarget({space:'oura',id:'https://evil.test'}),false);
});
test('Oura has its own selectable notification category',()=>{assert.equal(CATEGORIES.includes('oura'),true);assert.equal(new Set(CATEGORIES).size,6)});
test('one push bundles all eligible notifications for each device',()=>{
 const job=(id,s)=>({id,subscription_id:s,notification:{id,title:'Правки готовы',body:'Подборка обновлена.'}});
 const groups=groupJobs([job('1','a'),job('2','a'),job('3','b')]);assert.deepEqual(groups.map(x=>x.length),[2,1]);
 const p=notificationPayload(groups[0],3);assert.equal(p.title,'Новое в My Space');assert.deepEqual(p.delivery_ids,['1','2']);assert.equal(p.unread,3);
 const one=notificationPayload(groups[1],1);assert.equal(one.notification_id,'3');assert.equal(one.tag,'3');
 assert.equal(one.url,'?space=notifications&notice=3');
});
