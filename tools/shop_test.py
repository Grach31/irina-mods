import urllib.request
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36","Accept-Language":"ru-RU,ru"}
for u in ["https://limestore.com/ru_ru/catalog/women_outerwear?menu=3800",
 "https://a.cdn.lime-shine.com/p/3042ef2996e65a21abda8675a83a19c8.jpeg?w=600&q=85",
 "https://loverepublic.ru/catalog/new/",
 "https://imgcdn.loverepublic.ru/upload/images/64516/6451601762_50.jpg",
 "https://www.2moodstore.com/collection/new/",
 "https://12storeez.com/catalog/trikotaz/womencollection",
 "https://askent.ru/new/askent/",
 "https://www.ushatava.ru/store/w/novinki/",
 "https://upload.wikimedia.org/wikipedia/commons/9/90/Gabrielle_Chanel_en_marini%C3%A8re.jpg",
 "https://api.telegram.org"]:
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=25); b=r.read()
        print(r.status,len(b),u, b[:120] if b'<' in b[:200] else '')
    except Exception as e: print("ERR",getattr(e,'code',e),u)
