"""Telegram HTML-widget для приватной панели модерации Stambo.i."""
import json
import tg
import config

HTML = r'''<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:system-ui,sans-serif;color:var(--tg-theme-text-color,#222);margin:0;padding:13px;background:var(--tg-theme-bg-color,#faf8f5)}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #bbb;padding-bottom:9px}
.logo{font-family:serif;font-size:29px;letter-spacing:-1px}.tag{font-size:10px;letter-spacing:2px;color:var(--tg-theme-hint-color,#777)}
h2{font:24px serif;margin:20px 0 12px}
.stats{display:flex;gap:7px;margin:12px 0}
.stat{background:var(--tg-theme-secondary-bg-color,#eae5de);border-radius:10px;padding:10px;flex:1;text-align:center}
.stat b{font-size:22px;display:block}.stat small{font-size:10px}
article{background:var(--tg-theme-secondary-bg-color,#eee8e1);border-radius:12px;padding:14px;margin-top:12px}
.kicker{font-size:10px;letter-spacing:2px;text-transform:uppercase}
.headline{font:19px serif;margin:9px 0}
.meta{color:var(--tg-theme-hint-color,#777);font-size:12px;word-break:break-word}
.actions{display:flex;gap:6px;margin-top:15px;flex-wrap:wrap}
button{border:0;border-radius:8px;padding:12px 10px;background:var(--tg-theme-button-color,#181818);color:var(--tg-theme-button-text-color,#fff);flex:1;font-size:12px}
button.alt{background:var(--tg-theme-bg-color,#fff);color:var(--tg-theme-text-color,#111)}
#notice{font-size:12px;min-height:15px;margin-top:12px}footer{margin-top:15px;font-size:11px;color:var(--tg-theme-hint-color,#777)}
</style></head><body>
<header><div><div class="logo">Stambo.i</div><div class="tag">FASHION EDITORIAL · CONTROL</div></div><span>✦</span></header>
<h2>Панель публикаций</h2><div class="stats"><div class="stat"><b id="pending">—</b><small>На проверке</small></div><div class="stat"><b id="published">—</b><small>Опубликовано</small></div><div class="stat"><b id="rejected">—</b><small>Отклонено</small></div></div>
<article><div class="kicker">Черновик <span id="num"></span></div><div class="headline" id="title">Загрузка…</div><div class="meta" id="meta"></div>
<div class="actions"><button class="alt" id="prev">←</button><button class="alt" id="next">→</button><button id="approve">Опубликовать</button></div><div class="actions"><button class="alt" id="edit">✏ Правки</button><button class="alt" id="reject">✕ Отклонить</button></div></article>
<div id="notice"></div><footer>Публикация только по подтверждению · Обновить ↻</footer><button class="alt" id="refresh">↻ Обновить</button>
<script>
var data={},index=0,confirmId='';
function el(id){return document.getElementById(id)}
function show(){
el('pending').textContent=data.pending||0;el('published').textContent=data.published||0;el('rejected').textContent=data.rejected||0;
var a=data.items||[],d=a[index];el('num').textContent=a.length?(index+1)+' / '+a.length:'';
el('title').textContent=d?d.title:'Нет черновиков на проверке';
el('meta').textContent=d?d.kind+' · '+d.id:'Новые материалы появятся здесь';
el('approve').disabled=el('edit').disabled=el('reject').disabled=!d;
el('approve').textContent=confirmId&&d&&confirmId===d.id?'Подтвердить публикацию':'Опубликовать';
}
function req(s){el('notice').textContent='Обрабатываю…';TelegramWidget.request(s).then(function(r){try{data=JSON.parse(r.result||'{}');index=0;confirmId='';show();el('notice').textContent=data.notice||''}catch(e){el('notice').textContent='Ошибка ответа'}},function(e){el('notice').textContent=e.code||'Ошибка связи'})}
el('refresh').onclick=function(){req('refresh')};
el('next').onclick=function(){index=Math.min(index+1,(data.items||[]).length-1);confirmId='';show()};
el('prev').onclick=function(){index=Math.max(0,index-1);confirmId='';show()};
el('approve').onclick=function(){var d=(data.items||[])[index];if(!d)return;if(confirmId!==d.id){confirmId=d.id;show();el('notice').textContent='Подтверди публикацию повторным нажатием';return}req('ok:'+d.id)};
el('reject').onclick=function(){var d=(data.items||[])[index];if(d)req('no:'+d.id)};
el('edit').onclick=function(){var d=(data.items||[])[index];if(d)req('edit:'+d.id)};
show();req('refresh');
</script></body></html>'''

def snapshot(state, notice=''):
    drafts=state.get('drafts',{})
    pending=[(k,v) for k,v in drafts.items() if v.get('status')=='sent']
    pending.sort(key=lambda item:item[1].get('sent_at',''),reverse=True)
    result={'pending':len(pending),'published':sum(v.get('status')=='published' for v in drafts.values()),
            'rejected':sum(v.get('status')=='rejected' for v in drafts.values()),'items':[],
            'notice':notice[:140]}
    for did,d in pending[:6]:
        kind='Черновик'
        if '-news-' in did: kind='Новости моды'
        elif '-looks' in did: kind='Образы'
        elif '-mix-' in did: kind='Подборка'
        title=did.replace('-',' · ')
        result['items'].append({'id':did,'title':title[:65],'kind':kind})
    # Telegram allows at most 1024 UTF-8 bytes in query answer.
    while len(json.dumps(result,ensure_ascii=False).encode())>1000 and result['items']:
        result['items'].pop()
    return json.dumps(result,ensure_ascii=False,separators=(',',':'))

def send(chat):
    import zlib
    raw = HTML.encode('utf-8')
    if len(raw) > 32768 or len(zlib.compress(raw, 9)) > 4096:
        raise ValueError('Widget exceeds Telegram HTML limits')
    return tg.call('sendWidget',chat_id=chat,html=HTML,height=510,allow_queries=True,
                   caption='Stambo.i · модерация публикаций')

def handle(state,q):
    uid=q.get('from',{}).get('id')
    if uid not in config.ALLOWED or q.get('chat',{}).get('type')!='private' or q.get('chat',{}).get('id')!=uid:
        tg.call('answerWidgetQuery',widget_query_id=q['id'],data='{"notice":"Нет доступа"}')
        return
    action,_,did=q.get('data','').partition(':')
    if len(q.get('data','').encode('utf-8')) > 64:
        tg.call('answerWidgetQuery', widget_query_id=q['id'], data='{"notice":"Некорректный запрос"}')
        return
    notice=''
    d=state.get('drafts',{}).get(did)
    if action in ('ok','no','edit'):
        if not d or d.get('status')!='sent':
            notice='Черновик уже обработан'
        elif action=='ok':
            from datetime import datetime
            d['status']='approved'
            d['publish_at']=datetime.now(config.MSK).isoformat()
            notice='Одобрено. Бот опубликует материал.'
        elif action=='no':
            d['status']='rejected'
            notice='Черновик отклонён'
            try: tg.call('editMessageReplyMarkup',chat_id=uid,message_id=d['msg_id'],
                         reply_markup={'inline_keyboard':[[{'text':'❌ Не публикуем','callback_data':'noop'}]]})
            except Exception: pass
        else:
            d['status']='awaiting_edit'
            state['awaiting_edit']=did
            tg.call('sendMessage',chat_id=uid,text='✏️ Напиши одним сообщением, что поправить в '+did)
            notice='Напиши правки сообщением в этот чат'
    elif action!='refresh':
        notice='Неизвестное действие'
    tg.call('answerWidgetQuery',widget_query_id=q['id'],data=snapshot(state,notice))
