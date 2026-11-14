import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const scope={window:{},Date};vm.runInNewContext(fs.readFileSync(new URL('../miniapp/gestures.js',import.meta.url),'utf8'),scope);
function fixture({top=0,nested=false}={}){
 const listeners={},root={addEventListener:(name,fn)=>listeners[name]=fn};let refreshes=0,backs=0;
 const button={},target={parentElement:null,closest:s=>s==='button,a'?button:nested&&s.includes('.gallery')?{}:null};
 const scroller={contains:()=>true,scrollTop:top};const context={key:'moda:list',scroller,width:390,refreshable:true,canBack:true};const progress=[];
 const controller=new scope.window.MySpaceGestures({root,context:()=>context,refresh:()=>{refreshes++;context.busy=true;return Promise.resolve()},back:()=>backs++,progress:n=>progress.push(n)});
 const event=(x,y,cancelable=true)=>({target,touches:[{clientX:x,clientY:y}],changedTouches:[{clientX:x,clientY:y}],cancelable,preventDefault(){this.prevented=true}});
 return {controller,context,scroller,target,listeners,progress,event,get:()=>({refreshes,backs}),pull:(distance=100)=>{controller.start(event(180,100));controller.move(event(180,120));const move=event(180,100+distance);controller.move(move);controller.end(event(180,100+distance));return move}};
}
test('pull from a card gives immediate progress then refreshes once on release',()=>{const f=fixture();assert.equal(f.pull().prevented,true);assert.equal(f.get().refreshes,1);assert(f.progress.some(n=>n>=84));f.pull();assert.equal(f.get().refreshes,1)});
test('short pull and cancelled touch never issue a request',()=>{const f=fixture();f.pull(45);assert.equal(f.get().refreshes,0);assert.equal(f.progress.at(-1),0);f.controller.start(f.event(180,100));f.controller.move(f.event(180,200));f.listeners.touchcancel();f.controller.end(f.event(180,200));assert.equal(f.get().refreshes,0)});
test('scrolling back to top within the same gesture cannot trigger refresh',()=>{const f=fixture({top:150});f.controller.start(f.event(180,100));f.scroller.scrollTop=0;f.controller.move(f.event(180,230));f.controller.end(f.event(180,230));assert.equal(f.get().refreshes,0)});
test('horizontal carousel motion stays native, while a vertical top pull can refresh',()=>{const f=fixture({nested:true});f.controller.start(f.event(300,100));const e=f.event(100,105);f.controller.move(e);f.controller.end(e);assert.equal(e.prevented,undefined);assert.deepEqual(f.get(),{refreshes:0,backs:0});f.pull();assert.equal(f.get().refreshes,1)});
test('an upward scroll reversal does not become pull-to-refresh',()=>{const f=fixture();f.controller.start(f.event(180,100));f.controller.move(f.event(180,70));f.controller.move(f.event(180,240));f.controller.end(f.event(180,240));assert.equal(f.get().refreshes,0)});
test('navigation during a pull cancels its old screen context',()=>{const f=fixture();f.controller.start(f.event(180,100));f.controller.move(f.event(180,150));f.context.key='oura:list';f.controller.end(f.event(180,240));assert.equal(f.get().refreshes,0);assert.equal(f.progress.at(-1),0)});
test('edge back remains available outside horizontal carousels',()=>{const f=fixture();f.controller.start(f.event(10,100));f.controller.move(f.event(150,105));f.controller.end(f.event(150,105));assert.equal(f.get().backs,1);assert.equal(f.get().refreshes,0)});
test('noncancelable browser scrolling is never taken over',()=>{const f=fixture();f.controller.start(f.event(180,100));f.controller.move(f.event(180,200,false));f.controller.end(f.event(180,200));assert.equal(f.get().refreshes,0)});
test('a completed drag cannot accidentally open its card',()=>{const f=fixture();f.pull();const click={target:f.target,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};f.listeners.click(click);assert.equal(click.prevented,true);assert.equal(click.stopped,true);const next={target:f.target};f.listeners.click(next);assert.equal(next.prevented,undefined)});
