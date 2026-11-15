import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../miniapp/index.html',import.meta.url),'utf8');
const statusSource=html.slice(html.indexOf('function ouraStatusMessage('),html.indexOf('let ouraLoading='));
const loaderSource=html.slice(html.indexOf('let ouraLoading='),html.indexOf('async function fetchOura('));
const resumeSource=html.slice(html.indexOf("window.addEventListener('pageshow'"),html.indexOf('})();',html.indexOf("window.addEventListener('pageshow'")));
const now=Date.parse('2026-11-15T07:00:00Z');
const snapshot=(day='2026-11-15',updated='2026-11-15T06:59:00Z')=>({
 sleep:{detail:{day,total_seconds:27000}},updated_at:updated,
});

test('a recently fetched snapshot still identifies an older source night',()=>{
 const context=vm.createContext({Date,dayName:day=>day,valid:Number.isFinite});
 vm.runInContext(statusSource,context);
 const message=context.ouraStatusMessage(snapshot('2026-11-14'),now);
 assert.match(message,/Данные сна за 2026-11-14/);
 assert.match(message,/Ожидаем синхронизацию/);
 assert.doesNotMatch(message,/более 30 минут/);
});

test('transport freshness is separate from source dates and follows Moscow midnight',()=>{
 const context=vm.createContext({Date,dayName:day=>day,valid:Number.isFinite});
 vm.runInContext(statusSource,context);
 assert.match(context.ouraStatusMessage(snapshot(undefined,'2026-11-15T06:00:00Z'),now),/более 30 минут/);
 assert.doesNotMatch(context.ouraStatusMessage(snapshot(),now),/Ожидаем|более 30 минут/);
 assert.match(context.ouraStatusMessage(snapshot('2026-11-14','2026-11-14T21:10:00Z'),Date.parse('2026-11-14T21:15:00Z')),/Ожидаем синхронизацию/);
 assert.match(context.ouraStatusMessage({sleep:{detail:{day:'2026-11-15'}}},now),/ещё не поступили/);
});

test('resume and visible polling refresh Oura once, pause when hidden, and release failed loads',async()=>{
 let calls=0,release,fail=false;
 const events={};let poll;
 const context=vm.createContext({Promise,
  document:{hidden:false,addEventListener:(name,fn)=>events[name]=fn},
  window:{addEventListener:(name,fn)=>events[name]=fn},
  currentSpace:'oura',pwaSession:'private-session',load:()=>{},
  fetchOura:async()=>{calls++;if(fail)throw Error('offline');await new Promise(r=>release=r)},
  setInterval:(fn,ms)=>{assert.equal(ms,60000);poll=fn},
 });
 vm.runInContext(loaderSource+'\n'+resumeSource,context);
 events.pageshow();events.visibilitychange();poll();
 await Promise.resolve();await Promise.resolve();
 assert.equal(calls,1,'resume and polling share a single request');
 release();await context.loadOura();
 context.document.hidden=true;events.visibilitychange();poll();
 context.document.hidden=false;context.currentSpace='hub';events.pageshow();poll();
 context.currentSpace='oura';context.pwaSession='';poll();
 await Promise.resolve();assert.equal(calls,1,'no hidden, other-section or signed-out polling');
 context.pwaSession='private-session';fail=true;
 await assert.rejects(context.refreshVisibleOura(),/offline/);
 fail=false;const retry=context.refreshVisibleOura();
 await Promise.resolve();await Promise.resolve();
 assert.equal(calls,3,'failed loads release the in-flight guard');
 release();await retry;
});
