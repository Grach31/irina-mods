const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const {Window}=await import(process.env.HAPPY_DOM_PATH||'happy-dom');const root=path.join(__dirname,'..');const {buildEditorial}=require(path.join(root,'supabase/functions/myspace-publish/editorial.ts'));
 const window=new Window({url:'https://grach31.github.io/irina-mods/'}),doc=window.document;doc.write('<main id="root"></main>');window.eval(fs.readFileSync(path.join(root,'miniapp/editorial-publish.js'),'utf8'));
 const news={id:'news',title:'Новость',summary:'Готовая выжимка',image_url:'https://brand.example/image.jpg',url:'https://source.example/news',source:'Источник'};
 const history={id:'history',title:'Архив',year:1947,description:'Полный исходный текст без сокращений.',then:'Тогда',now:'Сейчас',photos:[{url:'https://brand.example/archive.jpg',caption:'Подпись',credit:'Музей',source_url:'https://museum.example/item'}]};
 let enabled=true,sends=0;const requests=[],states=[];
 const api=async b=>{requests.push(b);if(b.action==='editorial_list')return {items:states};
  if(b.action==='editorial_preview'){const post=buildEditorial(b.space,b.space==='fashion'?news:history,b.text);return {...post,revision:'approved:'+post.text,status:'draft',message_ids:[]}}
  if(b.action==='editorial_publish'){sends++;await new Promise(r=>setTimeout(r,15));states.push({space:b.space,source_id:b.id,status:'published',message_ids:[500]});return {ok:true,status:'published',message_ids:[500],url:'https://t.me/stamboi/500'}}throw Error('unknown');
 };
 const ui=new window.MySpaceEditorialPublisher({api,enabled:()=>enabled});ui.attach(doc.querySelector('main'),'fashion','news');
 const settle=async check=>{for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,5))}throw Error('DOM timeout')};
 doc.querySelector('.ep-open').click();await settle(()=>!ui.busy&&ui.data);assert(ui.dialog.open);assert.equal(sends,0);assert(!ui.editor.hidden);assert(ui.preview.querySelector('img'));assert(ui.preview.textContent.includes('Готовая выжимка'));
 ui.editor.value='Изменённый заголовок\n\nМой текст';ui.editor.dispatchEvent(new window.Event('input'));assert(ui.confirm.disabled);await ui.publish();assert.equal(sends,0);
 ui.update.click();await settle(()=>!ui.busy&&!ui.confirm.disabled);assert(ui.preview.textContent.includes('Мой текст'));
 ui.confirm.click();ui.confirm.click();await settle(()=>!ui.busy&&sends===1);assert(doc.querySelector('.ep-open').disabled);assert.equal(doc.querySelector('.ep-actions a').href,'https://t.me/stamboi/500');assert.equal(requests.filter(x=>x.action==='editorial_publish').length,1);assert.equal(requests.find(x=>x.action==='editorial_publish').text,'Изменённый заголовок\n\nМой текст');ui.dialog.close();
 ui.attach(doc.querySelector('main'),'history','history');doc.querySelector('[data-ep-space="history"] button').click();await settle(()=>!ui.busy&&ui.target.space==='history');assert(ui.editor.hidden);assert(ui.update.hidden);assert(ui.preview.textContent.includes(history.description));const image=ui.preview.querySelector('img');image.dispatchEvent(new window.Event('error'));assert(ui.confirm.disabled);await ui.publish();assert.equal(sends,1);ui.dialog.close();
 enabled=false;ui.repaint();assert([...doc.querySelectorAll('.ep-actions')].every(x=>x.hidden));
 console.log('PASS: buttons, read-only preview, editable news, full history, approval-only single send, failed image blocking and published link');window.happyDOM.abort();
})().catch(e=>{console.error(e);process.exit(1)});
