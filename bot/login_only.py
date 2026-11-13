"""Minimal owner-only My Space login-code bot. No editorial or publishing actions."""
import json, os, time, urllib.request, urllib.parse
TOKEN=os.environ["TELEGRAM_TOKEN"]
OWNER=880098519
API="https://api.telegram.org/bot"+TOKEN+"/"
PWA="https://rjnfokknhjmtuzturvub.supabase.co/functions/v1/myspace-pwa"
def api(method,payload):
    data=json.dumps(payload).encode()
    with urllib.request.urlopen(urllib.request.Request(API+method,data=data,headers={"Content-Type":"application/json"}),timeout=40) as r:
        return json.load(r)
def oidc():
    url=os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]+"&audience=stambo-pwa-actions"
    req=urllib.request.Request(url,headers={"Authorization":"Bearer "+os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})
    with urllib.request.urlopen(req,timeout=15) as r:return json.load(r)["value"]
def issue():
    req=urllib.request.Request(PWA,data=json.dumps({"action":"bot_issue","telegram_user_id":OWNER}).encode(),headers={"Content-Type":"application/json","Authorization":"Bearer "+oidc()})
    with urllib.request.urlopen(req,timeout=20) as r:return json.load(r)["code"]
def main():
    api("setMyCommands",{"commands":[{"command":"start","description":"Получить ключ для My Space"}]})
    offset=None
    start=time.time()
    while time.time()-start<230:
        try:
            args={"timeout":20,"allowed_updates":["message"]}
            if offset is not None:args["offset"]=offset
            updates=api("getUpdates",args).get("result",[])
            for u in updates:
                offset=max(offset or 0,u["update_id"]+1)
                msg=u.get("message") or {}
                chat=msg.get("chat") or {}
                if msg.get("from",{}).get("id")!=OWNER or chat.get("type")!="private":continue
                if msg.get("date",0)<start-600:continue
                text=str(msg.get("text","")).strip()
                if text.split("@")[0] not in ("/start","Получить ключ"):continue
                try:
                    code=issue()
                    message="Ключ для входа в My Space (10 минут, один раз):\\n<code>"+code+"</code>\\n\\nhttps://grach31.github.io/irina-mods/"
                    api("sendMessage",{"chat_id":OWNER,"text":message,"parse_mode":"HTML","reply_markup":{"keyboard":[[{"text":"Получить ключ"}]],"resize_keyboard":True}})
                except Exception as e:print("issue_failed",type(e).__name__)
        except Exception as e:
            print("poll_error",type(e).__name__)
            time.sleep(5)
if __name__=="__main__":main()
