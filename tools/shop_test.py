import urllib.request, os
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36","Accept-Language":"ru-RU,ru"}
os.makedirs("samples",exist_ok=True)
for n,u in [("lime","https://limestore.com/ru_ru/catalog/women_outerwear?menu=3800"),("limenew","https://limestore.com/ru_ru/catalog/women_knitwear?menu=7218"),
 ("lr","https://loverepublic.ru/catalog/new/"),("2mood","https://www.2moodstore.com/collection/new/"),
 ("askent","https://askent.ru/new/askent/"),("ushatava","https://www.ushatava.ru/store/w/novinki/")]:
    try:
        b=urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=30).read()
        open(f"samples/{n}.html","wb").write(b); print(n,len(b))
    except Exception as e: print("ERR",n,e)
