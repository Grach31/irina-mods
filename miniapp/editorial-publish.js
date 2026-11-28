/* Explicit moderator confirmation only. No background generation or automatic publishing. */
class MySpaceEditorialPublisher {
 constructor({api,enabled}){
  Object.assign(this,{api,enabled});this.states=new Map();this.lastSync=0;this.syncing=null;this.busy=false;this.target=null;this.generation=0;this.session=0;
  this.dialog=document.createElement('dialog');this.dialog.className='editorial-publish-dialog';this.dialog.setAttribute('aria-label','Предпросмотр публикации в Telegram');
  const close=document.createElement('button');close.type='button';close.className='ep-close';close.textContent='Закрыть';close.onclick=()=>{if(!this.publishing)this.dialog.close()};this.close=close;
  const title=document.createElement('h2');title.textContent='Публикация в Telegram';const channel=document.createElement('p');channel.className='ep-hint';channel.textContent='Канал Stambo.i · отправка только после подтверждения';
  this.message=document.createElement('p');this.message.className='ep-message';this.message.setAttribute('role','status');
  this.preview=document.createElement('div');this.preview.className='ep-preview';
  this.editor=document.createElement('textarea');this.editor.className='ep-editor';this.editor.setAttribute('aria-label','Текст новости для Telegram');this.editor.rows=8;
  this.editor.oninput=()=>{this.confirm.disabled=true;this.message.textContent='Текст изменён. Обнови предпросмотр перед отправкой.'};
  this.update=document.createElement('button');this.update.type='button';this.update.className='ep-update';this.update.textContent='Обновить предпросмотр';this.update.onclick=()=>this.prepare(this.target.space,this.target.id,this.editor.value);
  this.confirm=document.createElement('button');this.confirm.type='button';this.confirm.className='ep-confirm';this.confirm.textContent='Подтвердить и опубликовать';this.confirm.onclick=()=>this.publish();
  this.dialog.append(close,title,channel,this.message,this.preview,this.editor,this.update,this.confirm);document.body.append(this.dialog);
  this.dialog.addEventListener('cancel',e=>{if(this.publishing)e.preventDefault()});
 }
 attach(root,space,id){
  const box=document.createElement('div');box.className='ep-actions';box.dataset.epSpace=space;box.dataset.epId=id;
  const button=document.createElement('button');button.type='button';button.className='ep-open';button.onclick=()=>this.prepare(space,id);box.append(button);root.append(box);this.paint(box);
 }
 paint(box){
  box.hidden=!this.enabled();
  const state=this.states.get(box.dataset.epSpace+':'+box.dataset.epId),button=box.querySelector('button');box.querySelector('a')?.remove();
  button.disabled=['published','publishing','uncertain'].includes(state?.status);
  button.textContent={published:'Опубликовано в Telegram',publishing:'Публикация выполняется…',uncertain:'Отправка требует проверки',failed:state?.next_part>0?'Продолжить публикацию':'Повторить публикацию'}[state?.status]||'Опубликовать в Telegram';
  if(state?.message_ids?.length){const a=document.createElement('a');a.href='https://t.me/stamboi/'+state.message_ids[0];a.target='_blank';a.rel='noopener noreferrer';a.textContent=state.status==='published'?'Открыть пост ↗':'Открыть отправленную часть ↗';box.append(a)}
 }
 repaint(){document.querySelectorAll('[data-ep-space]').forEach(box=>this.paint(box))}
 reset(){
  this.session++;this.generation++;this.lastSync=0;this.states.clear();this.syncing=null;
  this.busy=false;this.publishing=false;this.data=null;this.target=null;this.preview.replaceChildren();
  this.message.replaceChildren();this.editor.value='';this.editor.disabled=false;
  if(this.dialog.open)this.dialog.close();
  this.repaint();
 }
 sync(force=false){
  if(!this.enabled())return Promise.resolve();if(this.syncing)return this.syncing;if(!force&&Date.now()-this.lastSync<30000)return Promise.resolve();
  const generation=this.generation;
  const request=this.api({action:'editorial_list'}).then(data=>{
   if(generation!==this.generation||!Array.isArray(data.items))return;
   for(const row of data.items)this.states.set(row.space+':'+row.source_id,row);
   this.lastSync=Date.now();this.repaint();
  }).catch(()=>{}).finally(()=>{if(this.syncing===request)this.syncing=null});
  this.syncing=request;return request;
 }
 error(error){return ({editorial_photo_required:'Нужна фотография именно к этому материалу. Публикация без фото недоступна.',media_download_failed:'Не удалось загрузить одно из фото. Ничего нового не отправлено.',media_format_invalid:'Одно из фото имеет неподдерживаемый формат.',media_size_invalid:'Одно из фото превышает допустимый размер.',editorial_changed:'Материал или фото изменились. Открой свежий предпросмотр перед отправкой.',editorial_unavailable:'Материал пока недоступен в опубликованной версии приложения.',editorial_text_invalid:'Проверь текст: он пустой или превышает допустимый объём.',delivery_unconfirmed:'Результат последней отправки требует проверки. Повтор заблокирован, чтобы не создать дубль.',already_processing:'Этот материал уже отправляется.',already_published:'Материал уже опубликован.',partial_revision_changed:'Часть поста уже отправлена, а материал изменился. Сначала нужна ручная сверка канала.',telegram_bot_not_allowed:'У бота нет доступа к каналу.',telegram_bot_not_admin:'Боту нужны права публикации в канале.',telegram_media_invalid:'Telegram отклонил одно из изображений.',telegram_configuration_required:'Нужно проверить подключение бота.'})[error.message]||'Не удалось выполнить действие: '+error.message}
 async prepare(space,id,text){
  if(this.busy||!this.enabled())return;this.target={space,id};this.busy=true;this.close.disabled=false;this.confirm.disabled=true;this.update.disabled=true;this.message.textContent='Проверяю материал и фотографии…';this.preview.replaceChildren();this.editor.hidden=true;this.update.hidden=true;
  const session=this.session;
  if(!this.dialog.open)this.dialog.showModal();
  try{
   const data=await this.api({action:'editorial_preview',space,id,...(text!==undefined?{text}:{})});if(session!==this.session)return;this.data=data;
   this.states.set(space+':'+id,{status:data.status,message_ids:data.message_ids,next_part:data.next_part});this.repaint();
   for(const part of data.parts){
    const card=document.createElement('div');card.className='ep-part';
    if(part.kind==='media')for(const url of part.photos){const img=document.createElement('img');img.src=url;img.alt='Фото к публикации';img.onerror=()=>{this.confirm.disabled=true;this.message.textContent='Фото не загрузилось в предпросмотре. Обнови его перед отправкой.'};card.append(img)}
    if(part.html){const copy=document.createElement('div');copy.className='ep-copy';this.copyHTML(part.html,copy);card.append(copy)}
    this.preview.append(card);
   }
   this.editor.value=data.text;this.editor.hidden=space!=='fashion';this.update.hidden=space!=='fashion';
   this.message.textContent=data.status==='published'?'Этот материал уже опубликован.':data.status==='uncertain'?'Результат отправки требует ручной проверки.':data.parts.length>1?'Будет отправлено частей: '+data.parts.length+'. Полный текст сохранён.':'Фото и подпись готовы к отправке.';
   this.confirm.disabled=['published','publishing','uncertain'].includes(data.status);
   this.confirm.textContent=data.next_part>0?'Подтвердить продолжение публикации':'Подтвердить и опубликовать';
   if(data.status==='failed'&&data.next_part>0)this.message.textContent='Уже отправлено частей: '+data.next_part+'. Будут отправлены только оставшиеся.';
  }catch(e){if(session===this.session){this.data=null;this.message.textContent=this.error(e)}}finally{if(session===this.session){this.busy=false;this.update.disabled=false}}
 }
 copyHTML(html,root){
  const doc=new DOMParser().parseFromString(html,'text/html');const copy=(node,parent)=>{if(node.nodeType===3){parent.append(document.createTextNode(node.textContent));return}if(node.nodeType!==1)return;let dest=parent;const tag=node.tagName.toLowerCase();if(['b','i','a'].includes(tag)){dest=document.createElement(tag);if(tag==='a'){try{const url=new URL(node.getAttribute('href'));if(url.protocol!=='https:')return;dest.href=url.href;dest.target='_blank';dest.rel='noopener noreferrer'}catch{return}}parent.append(dest)}for(const child of node.childNodes)copy(child,dest)};for(const child of doc.body.childNodes)copy(child,root);
 }
 async publish(){
  if(this.busy||!this.data||this.confirm.disabled||!this.enabled())return;
  this.busy=true;this.publishing=true;this.close.disabled=true;this.confirm.disabled=true;this.update.disabled=true;this.editor.disabled=true;this.message.textContent='Отправляю в Telegram…';
  const {space,id}=this.target;
  const session=this.session;
  try{
   const result=await this.api({action:'editorial_publish',space,id,revision:this.data.revision,...(space==='fashion'?{text:this.data.text}:{})});
   if(session!==this.session)return;
   this.generation++;this.states.set(space+':'+id,{status:'published',message_ids:result.message_ids});this.repaint();this.message.textContent='Опубликовано в Telegram.';const link=document.createElement('a');link.href=result.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Открыть пост ↗';this.message.append(document.createElement('br'),link);
  }catch(e){
   if(session!==this.session)return;
   this.message.textContent=e.name==='TimeoutError'?'Время ожидания истекло. Проверь статус отправки перед повтором.':this.error(e)+(e.telegramDescription?'\nTelegram: '+e.telegramDescription:'');await this.sync(true)
  }
  finally{if(session===this.session){this.busy=false;this.publishing=false;this.close.disabled=false;this.update.disabled=false;this.editor.disabled=false}}
 }
}
window.MySpaceEditorialPublisher=MySpaceEditorialPublisher;
