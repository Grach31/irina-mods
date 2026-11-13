"""Deliver today's editorial picks to the owner privately; never publish to a group."""
import json, os, pathlib, urllib.request, datetime, zoneinfo, subprocess, time
ROOT=pathlib.Path(__file__).resolve().parents[1]
OWNER=880098519
def send(token, text):
    url="https://api.telegram.org/bot"+token+"/sendMessage"
    data=json.dumps({"chat_id":OWNER,"text":text,"disable_web_page_preview":True}).encode()
    req=urllib.request.Request(url,data=data,headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=25) as response:
        result=json.load(response)
    if not result.get("ok"):raise RuntimeError("Telegram delivery failed")
    return result["result"]["message_id"]
def main():
    today=datetime.datetime.now(zoneinfo.ZoneInfo("Europe/Moscow")).date().isoformat()
    paths=sorted((ROOT/"drafts").glob(today+"-*.json"))
    state_path=ROOT/"state"/"delivery_private.json"
    state=json.loads(state_path.read_text()) if state_path.exists() else {"delivered":{}}
    token=os.environ["TELEGRAM_TOKEN"]
    count=0
    for path in paths:
        d=json.loads(path.read_text())
        if d.get("type")!="picks" or d.get("hold") is True:continue
        key=d.get("id",path.stem)
        if key in state["delivered"]:continue
        items=d.get("items",[])
        if not items:continue
        lines=["📝 Черновик Stambo.i — только на проверку",str(key),""]
        for item in items:
            lines.append(str(item.get("name","Товар"))+" — "+str(item.get("price",""))+" ₽")
            lines.append(str(item.get("url","")))
        lines+=["","⚠️ Бот пока не администратор группы. Публикация отключена.","Этот материал не опубликован."]
        message_id=send(token,"\n".join(lines)[:3900])
        state["delivered"][key]={"message_id":message_id,"sent_at":datetime.datetime.now(datetime.timezone.utc).isoformat()}
        state_path.parent.mkdir(parents=True,exist_ok=True)
        state_path.write_text(json.dumps(state,ensure_ascii=False,indent=2)+"\n")
        subprocess.run(["git","add",str(state_path.relative_to(ROOT))],cwd=ROOT,check=True)
        subprocess.run(["git","-c","user.name=github-actions[bot]","-c","user.email=41898282+github-actions[bot]@users.noreply.github.com","commit","-m","Record private editorial delivery"],cwd=ROOT,check=True)
        subprocess.run(["git","push"],cwd=ROOT,check=True)
        count+=1
    print("private_drafts_delivered",count)
if __name__=="__main__":main()
