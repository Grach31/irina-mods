import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../miniapp/index.html',import.meta.url),'utf8');
const statusSource=html.slice(html.indexOf('function ouraSourceStatusMessage('),html.indexOf('let ouraLoading='));
const loaderSource=html.slice(html.indexOf('let ouraLoading='),html.indexOf('async function fetchOura('));
const resumeSource=html.slice(html.indexOf("window.addEventListener('pageshow'"),html.indexOf('})();',html.indexOf("window.addEventListener('pageshow'")));
const now=Date.parse('2026-11-16T09:30:00Z');
const snapshot=(day='2026-11-16',updated='2026-11-16T09:30:00Z')=>({
 sleep:{score:91,detail:{day,total_seconds:27000}},readiness:{score:92},activity:{score:80},
 history:[{day,readiness:92,sleep:91}],updated_at:updated,
});

test('a 12:30 check still shows yesterday source dates and pending today near the header',()=>{
 const context=vm.createContext({Date,dayName:day=>day,valid:Number.isFinite});
 vm.runInContext(statusSource,context);
 const message=context.ouraSourceStatusMessage(snapshot('2026-11-15'),now);
 assert.match(message,/Данные сна за 2026-11-15/);
 assert.match(message,/Готовность за 2026-11-15/);
 assert.match(message,/За 2026-11-16 сон и готовность ещё не поступили из Oura/);
 assert.match(message,/Откройте приложение Oura/);
 assert(html.indexOf('id="ouraSourceStatus"')<html.indexOf('id="ouraScoreTiles"'));
 assert.doesNotMatch(message,/Обновлено/);
 assert.doesNotMatch(message,/более 30 минут/);
});

test('new today data clears waiting and readiness date is independent of the sleep date',()=>{
 const context=vm.createContext({Date,dayName:day=>day,valid:Number.isFinite});
 vm.runInContext(statusSource,context);
 assert.doesNotMatch(context.ouraSourceStatusMessage(snapshot(),now),/ещё не поступил|Откройте/);
 const mixed=snapshot();mixed.history=[{day:'2026-11-15',readiness:80}];
 const message=context.ouraSourceStatusMessage(mixed,now);
 assert.match(message,/Данные сна за 2026-11-16/);
 assert.match(message,/Готовность за 2026-11-15/);
 assert.match(message,/За 2026-11-16 готовность ещё не поступила/);
 mixed.readiness.day='2026-11-16';
 assert.doesNotMatch(context.ouraSourceStatusMessage(mixed,now),/ещё не поступил/);
 mixed.readiness={score:92};mixed.history=[];
 assert.match(context.ouraSourceStatusMessage(mixed,now),/Дата данных готовности пока не доступна/);
});

test('check freshness is separate from source dates and follows Moscow midnight',()=>{
 const context=vm.createContext({Date,dayName:day=>day,valid:Number.isFinite});
 vm.runInContext(statusSource,context);
 assert.match(context.ouraStatusMessage(snapshot(undefined,'2026-11-16T06:00:00Z'),now),/проверка Oura была более 30 минут/);
 assert.doesNotMatch(context.ouraStatusMessage(snapshot(),now),/более 30 минут/);
 assert.match(context.ouraSourceStatusMessage(snapshot('2026-11-15','2026-11-15T21:10:00Z'),Date.parse('2026-11-15T21:15:00Z')),/За 2026-11-16/);
 assert.match(context.ouraSourceStatusMessage({sleep:{detail:{day:'2026-11-16'}}},now),/Дата данных сна пока не доступна/);
});

test('a selected archive day remains explicit while live source dates and check time stay separate',()=>{
 const selectSource=html.slice(html.indexOf('function selectOuraDay('),html.indexOf("$('ouraToday').onclick="));
 const renderSource=html.slice(html.indexOf('function renderOura('),html.indexOf('function ouraSourceStatusMessage('));
 const values={};let stageInput;
 class TestDate extends Date{static now(){return now}}
 const context=vm.createContext({Date:TestDate,Number,Array,ouraLive:null,ouraSelectedDate:'2026-11-15',selectedScore:'sleep',
  setValue:(id,v)=>values[id]=v,integer:n=>String(n??'—'),numeric:n=>String(n??'—'),prettySeconds:n=>String(n??'—'),
  timeOf:value=>value||'—',dayName:day=>day||'—',valid:Number.isFinite,
  renderCycleDetails:()=>{},renderOuraCharts:()=>{},explainScore:()=>{},stages:entry=>stageInput=entry,
 });
 vm.runInContext(statusSource+'\n'+selectSource+'\n'+renderSource,context);
 const data=snapshot();const archived={day:'2026-11-15',sleep:70,readiness:71};data.history.unshift(archived);
 context.renderOura(data);
 assert.match(values.ouraDate,/Проверено в Oura .*12:30/);
 assert.doesNotMatch(values.ouraDate,/Обновлено/);
 assert.equal(values.ouraSelectedDay,'Архив: показатели за 2026-11-15');
 assert.equal(values.ouraSleep,'70');
 assert.match(values.ouraSourceStatus,/Данные сна за 2026-11-16/);
 assert.equal(stageInput,archived,'archive cannot show the live sleep phase chart');
});

test('resume and visible polling refresh Oura once, pause when hidden, and release failed loads',async()=>{
 let calls=0,release,fail=false;
 const events={};let poll;
 const context=vm.createContext({Promise,
  document:{hidden:false,addEventListener:(name,fn)=>events[name]=fn},
  window:{addEventListener:(name,fn)=>events[name]=fn},
  currentSpace:'oura',pwaSession:'private-session',load:()=>{},ouraSelectedDate:'2026-11-15',ouraLive:{},renderOura:()=>{},
  fetchOura:async()=>{calls++;if(fail)throw Error('offline');await new Promise(r=>release=r)},
  setInterval:(fn,ms)=>{assert.equal(ms,60000);poll=fn},
 });
 vm.runInContext(loaderSource+'\n'+resumeSource,context);
 events.pageshow();events.visibilitychange();poll();
 await Promise.resolve();await Promise.resolve();
 assert.equal(calls,1,'resume and polling share a single request');
 assert.equal(context.ouraSelectedDate,null,'resume resets an old archive selection');
 release();await context.loadOura();
 context.ouraSelectedDate='2026-11-15';poll();await Promise.resolve();await Promise.resolve();
 assert.equal(context.ouraSelectedDate,'2026-11-15','regular polling preserves an intentional archive choice');
 release();await context.loadOura();
 context.document.hidden=true;events.visibilitychange();poll();
 context.document.hidden=false;context.currentSpace='hub';events.pageshow();poll();
 context.currentSpace='oura';context.pwaSession='';poll();
 await Promise.resolve();assert.equal(calls,2,'no hidden, other-section or signed-out polling');
 context.pwaSession='private-session';fail=true;
 await assert.rejects(context.refreshVisibleOura(),/offline/);
 fail=false;const retry=context.refreshVisibleOura();
 await Promise.resolve();await Promise.resolve();
 assert.equal(calls,4,'failed loads release the in-flight guard');
 release();await retry;
 context.ouraSelectedDate='2026-11-15';
 const reopen=context.showLatestOura();await Promise.resolve();await Promise.resolve();
 assert.equal(context.ouraSelectedDate,null,'reopening shows the latest source day');
 assert.match(html,/if\(space==='oura'\)showLatestOura\(\)/,'the Oura section uses the reset path');
 release();await reopen;
});
