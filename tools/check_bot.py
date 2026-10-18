"""Проверка токена бота: имя бота и последние чаты, которые ему писали."""
import json, os, urllib.request
T = os.environ["TELEGRAM_TOKEN"]
def call(m):
    with urllib.request.urlopen(f"https://api.telegram.org/bot{T}/{m}", timeout=30) as r:
        return json.load(r)["result"]
me = call("getMe")
print("BOT", me.get("username"), me.get("first_name"))
seen = {}
for u in call("getUpdates"):
    for k in ("message", "channel_post", "my_chat_member"):
        m = u.get(k)
        if m and "chat" in m:
            c = m["chat"]
            seen[c["id"]] = (c.get("type"), c.get("title") or c.get("first_name") or "", c.get("username") or "")
for cid, info in seen.items():
    print("CHAT", cid, *info)
