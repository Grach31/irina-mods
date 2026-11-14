/* Shared touch gestures. Capture only a deliberate downward drag from the top. */
class MySpaceGestures {
 constructor({root=document,context,refresh,back,progress}){
  Object.assign(this,{root,context,refresh,back,progress});this.gesture=null;this.blockedClick=null;
  root.addEventListener('touchstart',e=>this.start(e),{passive:true});
  root.addEventListener('touchmove',e=>this.move(e),{passive:false});
  root.addEventListener('touchend',e=>this.end(e),{passive:false});
  root.addEventListener('touchcancel',()=>this.cancel(),{passive:true});
  root.addEventListener('click',e=>{const b=this.blockedClick;this.blockedClick=null;if(b&&Date.now()<b.until&&(b.target===e.target||b.target.closest?.('button,a')===e.target.closest?.('button,a')&&!!e.target.closest?.('button,a'))){e.preventDefault();e.stopImmediatePropagation()}},true);
 }
 cancel(){if(this.gesture?.pulling)this.progress(0);this.gesture=null}
 start(e){
  this.cancel();const c=this.context();if(e.touches.length!==1||!c?.scroller||c.busy||c.disabled)return;
  const el=e.target;if(!c.scroller.contains(el)||el.closest('input,textarea,select,[contenteditable="true"],[role="slider"]'))return;
  let nestedScroll=false;for(let p=el;p&&p!==c.scroller;p=p.parentElement){if(p.scrollTop>1&&p.scrollHeight>p.clientHeight){nestedScroll=true;break}}
  const t=e.touches[0];this.gesture={...c,x:t.clientX,y:t.clientY,at:Date.now(),target:el,
   eligible:c.refreshable&&c.scroller.scrollTop<=1&&!nestedScroll,axis:null,pulling:false,distance:0,
   nestedHorizontal:!!el.closest('.gallery,.fashion-tags,.oura-switch,.oura-chartbox,.tabs,.cycle-day-scroll,.myspace-themes'),
   fromLeft:t.clientX<=34,fromRight:t.clientX>=c.width-34};
 }
 move(e){
  const g=this.gesture;if(!g)return;if(e.touches.length!==1||g.key!==this.context()?.key){this.cancel();return}
  const t=e.touches[0],dx=t.clientX-g.x,dy=t.clientY-g.y;
  // Keep Safari's rubber-band from taking ownership before intent passes the slop.
  if(g.eligible&&!g.axis&&dy>0&&dy>Math.abs(dx)*1.25&&e.cancelable)e.preventDefault();
  if(!g.axis&&Math.max(Math.abs(dx),Math.abs(dy))>9){
   if(Math.abs(dx)>Math.abs(dy)*1.25)g.axis='x';
   else if(Math.abs(dy)>Math.abs(dx)*1.25)g.axis='y';
  }
  if(!g.pulling&&(dy< -9||g.scroller.scrollTop>2))g.eligible=false;
  if(g.axis==='y'&&g.eligible&&dy>9){
   // Never fight a scroll already owned by the browser.
   if(!e.cancelable){this.cancel();return}
   e.preventDefault();g.pulling=true;g.distance=Math.min(130,Math.max(0,dy));this.progress(g.distance);
  }
 }
 end(e){
  const g=this.gesture;this.gesture=null;if(!g)return;
  if(g.key!==this.context()?.key){this.progress(0);return}
  if(g.pulling){
   if(e.changedTouches[0])g.distance=Math.max(0,e.changedTouches[0].clientY-g.y);
   if(e.cancelable)e.preventDefault();this.blockedClick={target:g.target,until:Date.now()+400};
   if(g.distance>=84){Promise.resolve(this.refresh()).catch(()=>{})}else this.progress(0);return;
  }
  const t=e.changedTouches[0];if(!t)return;const dx=t.clientX-g.x,dy=t.clientY-g.y;
  const edgeBack=(g.fromRight&&dx< -85)||(g.fromLeft&&dx>85);
  if(g.canBack&&!g.nestedHorizontal&&g.axis!=='y'&&edgeBack&&Math.abs(dx)>Math.abs(dy)*1.45&&Date.now()-g.at<1000){if(e.cancelable)e.preventDefault();this.back()}
 }
}
window.MySpaceGestures=MySpaceGestures;
