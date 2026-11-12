"""Бот канала Stambo.i. Работает в GitHub Actions почти без перерыва (LOOP_MINUTES) и сразу отвечает на кнопки.

1. Забирает сообщения и нажатия кнопок Ирины.
2. Отправляет Ирине новые черновики из drafts/ с кнопками.
3. Публикует в канал одобренные посты, когда подошло их время.
Состояние хранится в state/state.json, просьбы Ирины — в data/requests.json.
"""
import glob
import hashlib
import html
import json
import os
import subprocess
import sys
import time
import traceback
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))
import config  # noqa: E402
import render  # noqa: E402
import tg  # noqa: E402
import widget  # noqa: E402

ROOT = config.DATA  # закрытый репозиторий данных (черновики, состояние, просьбы)
STATE = os.path.join(ROOT, "state", "state.json")
REQUESTS = os.path.join(ROOT, "data", "requests.json")
REQ_DIR = os.path.join(ROOT, "data", "requests")


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def now():
    return datetime.now(config.MSK)


def publish_time(slot):
    """Когда выпустить одобренный пост."""
    t = now()
    if slot:
        h, m = map(int, slot.split(":"))
        at = t.replace(hour=h, minute=m, second=0, microsecond=0)
        if at > t:
            return at
    else:
        at = t
    if 8 <= t.hour < config.LAST_HOUR:
        return t
    h, m = map(int, (slot or config.MORNING_SLOT).split(":"))
    nxt = t + timedelta(days=1) if t.hour >= 8 else t
    return nxt.replace(hour=h, minute=m, second=0, microsecond=0)


def fmt_when(at):
    t = now()
    if at <= t + timedelta(minutes=1):
        return "в ближайшие 20 минут"
    day = "сегодня" if at.date() == t.date() else "завтра" if at.date() == (t + timedelta(days=1)).date() else at.strftime("%d.%m")
    return f"{day} в {at:%H:%M}"


def keyboard(did, slot):
    label = "✅ Опубликовать"
    return {"inline_keyboard": [[{"text": label, "callback_data": f"ok:{did}"}],
                                [{"text": "✏️ Поправить", "callback_data": f"edit:{did}"},
                                 {"text": "❌ Не надо", "callback_data": f"no:{did}"}]]}


def status_markup(text):
    return {"inline_keyboard": [[{"text": text, "callback_data": "noop"}]]}


def handle_updates(state, requests, wait=0):
    updates = tg.call("getUpdates", offset=state.get("offset", 0), timeout=wait,
                      allowed_updates=["message", "callback_query", "widget_query"])
    for u in updates:
        state["offset"] = u["update_id"] + 1
        try:
            if "widget_query" in u:
                widget.handle(state, u["widget_query"])
            elif "callback_query" in u:
                on_button(state, u["callback_query"])
            elif "message" in u:
                on_message(state, requests, u["message"])
        except Exception:
            traceback.print_exc()
            if "callback_query" in u:      # иначе на кнопке у Ирины так и крутится индикатор
                try:
                    tg.call("answerCallbackQuery", callback_query_id=u["callback_query"]["id"],
                            text="Не получилось, нажми ещё раз")
                except Exception:
                    traceback.print_exc()
    return len(updates)


def on_button(state, q):
    uid = q["from"]["id"]
    if uid not in config.ALLOWED or uid in config.READ_ONLY:
        tg.call("answerCallbackQuery", callback_query_id=q["id"], text="Только просмотр")
        return
    action, _, did = q.get("data", "").partition(":")
    d = state["drafts"].get(did)
    if not d or d["status"] not in ("sent", "awaiting_edit"):
        tg.call("answerCallbackQuery", callback_query_id=q["id"], text="Этот черновик уже обработан")
        return
    chat, mid = q["message"]["chat"]["id"], q["message"]["message_id"]
    if action in ("ok", "no") and state.get("awaiting_edit") == did:
        state["awaiting_edit"] = None
    if action == "ok":
        # публикуем сразу после одобрения
        d.update(status="approved", publish_at=now().isoformat())
        tg.call("answerCallbackQuery", callback_query_id=q["id"], text="Публикую")
    elif action == "no":
        d["status"] = "rejected"
        tg.call("answerCallbackQuery", callback_query_id=q["id"], text="Не публикую")
        tg.call("editMessageReplyMarkup", chat_id=chat, message_id=mid, reply_markup=status_markup("❌ Не публикуем"))
    elif action == "edit":
        d["status"] = "awaiting_edit"
        state["awaiting_edit"] = did
        tg.call("answerCallbackQuery", callback_query_id=q["id"])
        tg.call("sendMessage", chat_id=chat, reply_to_message_id=mid,
                text="Напиши одним сообщением, что поправить: текст, вещи, фото, время. "
                     "Переделаю и пришлю новый вариант в течение часа.")


def on_message(state, requests, m):
    uid = m.get("from", {}).get("id")
    chat = m["chat"]["id"]
    if m["chat"]["type"] != "private":
        return
    text = (m.get("text") or m.get("caption") or "").strip()
    if uid not in config.ALLOWED:
        if text.split()[0:1] in (["/start"], ["/panel"], ["/ping"], ["/app"], ["/miniapp"]):
            tg.call("sendMessage", chat_id=chat, text=(
                "Доступ к панели Stambo.i ограничен. "
                "Этот Telegram-аккаунт не добавлен в список редакторов. "
                "Попроси владельца проекта добавить твой Telegram ID в настройки бота."
            ))
        return
    if text.split()[0:1] in (["/app"], ["/miniapp"]):
        tg.call("sendMessage", chat_id=chat, text=(
            "My Space — два раздела: Moda и Oura Ring. Открывай черновики и показатели "
            "на весь экран. Публикация только после подтверждения."
        ), reply_markup={"keyboard": [[{"text": "✦ Открыть My Space",
            "web_app": {"url": "https://grach31.github.io/irina-mods/?v=20261112-myspace1"}}]],
            "resize_keyboard": True, "is_persistent": True})
        return
    if text.split()[0:1] in (["/oura"], ["/ring"]):
        # Inline Web App buttons include signed Telegram initData; reply keyboard buttons do not.
        tg.call("sendMessage", chat_id=chat, text=(
            "Oura Ring — открой защищённый раздел кнопкой ниже. "
            "Доступ к показателям проверяется по аккаунту Telegram."
        ), reply_markup={"inline_keyboard": [[{
            "text": "◉ Открыть Oura Ring",
            "web_app": {"url": "https://grach31.github.io/irina-mods/?v=20261112-oura-inline&space=oura"}
        }]]})
        return
    if m.get("web_app_data"):
        import miniapp
        miniapp.handle(state, m, tg, config, now)
        return
    if text.split()[0:1] == ["/ping"]:
        tg.call("sendMessage", chat_id=chat, text="Stambo.i на связи ✅. Для панели отправь /panel.")
        return
    if text.split()[0:1] == ["/panel"]:
        try:
            widget.send(chat)
        except Exception as exc:
            # Never silently ignore a failed widget delivery. Keep moderation private.
            log("widget delivery failed:", type(exc).__name__, str(exc)[:200])
            tg.call("sendMessage", chat_id=chat, text=(
                "Панель временно не открылась. Бот работает, но Telegram отклонил виджет. "
                "Попробуй обновить Telegram и повторить /panel. "
                "Оригинальные черновики остаются в чате; публикация не затронута."
            ))
        return
    if text.startswith("/start"):
        if uid in config.READ_ONLY:
            tg.call("sendMessage", chat_id=chat, text="Доступ к Stambo.i открыт в режиме просмотра. Отправь /app.")
            return
        tg.call("sendMessage", chat_id=chat, text=(
            "Привет! Я помощник канала Stambo.i 🤍\n\n"
            "Каждый день присылаю черновики постов — жми ✅, ✏️ или ❌.\n"
            "Можешь написать мне идею, например «подборка тёплых свитеров до 10 тысяч» "
            "или «пост про кожаные брюки», можно с ссылкой или фото — сделаю черновик в течение часа."))
        return
    if uid in config.READ_ONLY:
        tg.call("sendMessage", chat_id=chat, text="У тебя доступ только к просмотру. Открой /app.")
        return
    photos = []
    if m.get("photo"):
        photos.append(m["photo"][-1]["file_id"])
    did = state.get("awaiting_edit")
    if did and did in state["drafts"]:
        d = state["drafts"][did]
        d.update(status="edit_requested", comment=text)
        if photos:
            d["comment_photos"] = save_photos(f"edit-{did}", photos)
        state["awaiting_edit"] = None
        tg.call("sendMessage", chat_id=chat, text="Принято ✏️ Переделаю и пришлю новый вариант в течение часа.")
        return
    if not text and not photos:
        return
    gid = m.get("media_group_id")
    if gid:
        # альбом из нескольких фото приходит отдельными сообщениями — собираем в одну просьбу
        for r in requests:
            if r.get("group") == gid and r["status"] == "new":
                r["photos"] += save_photos(f"{r['id']}-g{len(r['photos'])}", photos)
                if text and not r["text"]:
                    r["text"] = text
                return
    rid = f"r{m['message_id']}"
    req = {"id": rid, "text": text, "photos": save_photos(rid, photos),
           "date": now().isoformat(timespec="minutes"), "status": "new"}
    if gid:
        req["group"] = gid
    requests.append(req)
    tg.call("sendMessage", chat_id=chat, text="Поняла идею 🙌 Черновик пришлю в течение часа.")


def save_photos(prefix, file_ids):
    paths = []
    os.makedirs(REQ_DIR, exist_ok=True)
    for i, fid in enumerate(file_ids):
        try:
            p = os.path.join(REQ_DIR, f"{prefix}-{i}.jpg")
            with open(p, "wb") as f:
                f.write(tg.download_file(fid))
            paths.append(os.path.relpath(p, ROOT))
        except Exception:
            traceback.print_exc()
    return paths


def send_new_drafts(state, requests):
    for path in sorted(glob.glob(os.path.join(ROOT, "drafts", "*.json"))):
        draft = load(path, None)
        if not draft:
            continue
        did = draft["id"]
        if did in state["drafts"]:
            continue
        if draft.get("hold"):
            preview_held(state, draft)
            continue
        state.get("held", {}).pop(did, None)
        is_video = draft.get("type") == "item" and bool(draft.get("video"))
        delivered_message_ids = []
        try:
            if is_video:
                # визуализация вещи: видео по ссылке (Higgsfield) — скачиваем, шлём Ирине; в канал уйдёт по file_id
                if draft.get("image"):
                    save_previews(did, [render.to_jpeg(im) for im in draw_all(draft)])
                msg = tg.send_video_bytes(config.IRINA, tg.fetch(draft["video"]), caption=draft["text"],
                                          reply_markup=keyboard(did, draft.get("slot")))
                extra = {"video_file_id": msg["video"]["file_id"]}
            else:
                if draft.get("type") == "looks":
                    groups = []
                    for i, look in enumerate(draft["looks"]):
                        images = [render.look_slide(look, i + 1, len(draft["looks"]))]
                        images += [render.photo(it["img"], ROOT) for it in look["items"]]
                        parts = [f"<b>Образ {i + 1}. {html.escape(look.get('title', ''))}</b>"]
                        for it in look["items"]:
                            parts.append(f'<a href="{html.escape(it["url"], quote=True)}">{html.escape(it.get("short") or it["name"])}</a> — {it["price"]:,} ₽ · {html.escape(it["shop"])}')
                        groups.append((images[:10], "\\n".join(parts)))
                    jpegs = [render.to_jpeg(im) for ims, _ in groups for im in ims]
                else:
                    jpegs = [render.to_jpeg(im) for im in draw_all(draft)]
                save_previews(did, jpegs)
            if is_video:
                pass                                    # видео уже отправлено выше
            elif draft.get("type") == "looks":
                # Один альбом на каждый образ: общий флэтлей, затем фото всех вещей.
                all_ids = []
                first_mid = None
                for images, caption in groups:
                    album = tg.send_media_group_bytes(config.IRINA, [render.to_jpeg(im) for im in images], caption=caption)
                    if len(album) != len(images):
                        raise RuntimeError(f"Telegram returned {len(album)}/{len(images)} photos for look")
                    if first_mid is None:
                        first_mid = album[0]["message_id"]
                    all_ids.append([m["photo"][-1]["file_id"] for m in album])
                    delivered_message_ids.append([m["message_id"] for m in album])
                msg = tg.call("sendMessage", chat_id=config.IRINA, reply_to_message_id=first_mid,
                              text=f"Подборка: {len(all_ids)} образа(ов). Опубликовать все альбомы?",
                              reply_markup=keyboard(did, draft.get("slot")))
                extra = {"album_file_ids": all_ids, "file_id": all_ids[0][0],
                         "album_message_ids": delivered_message_ids,
                         "photo_count": sum(map(len, delivered_message_ids))}
            elif len(jpegs) > 1:
                # карусель: альбом с подписью, кнопки — отдельным сообщением (к альбому их не прикрепить)
                album = tg.send_media_group_bytes(config.IRINA, jpegs, caption=draft["text"])
                if len(album) != len(jpegs):
                    raise RuntimeError(f"Telegram returned {len(album)}/{len(jpegs)} photos")
                delivered_message_ids.append([m["message_id"] for m in album])
                msg = tg.call("sendMessage", chat_id=config.IRINA, reply_to_message_id=album[0]["message_id"],
                              text=f"Карусель из {len(jpegs)} фото ☝️ Публикуем?",
                              reply_markup=keyboard(did, draft.get("slot")))
                extra = {"file_ids": [m["photo"][-1]["file_id"] for m in album]}
                extra["file_id"] = extra["file_ids"][0]
                extra["album_message_ids"] = delivered_message_ids
                extra["photo_count"] = len(album)
            else:
                msg = tg.send_photo_bytes(config.IRINA, jpegs[0], caption=draft["text"],
                                          reply_markup=keyboard(did, draft.get("slot")))
                extra = {"file_id": msg["photo"][-1]["file_id"]}
        except Exception as e:
            traceback.print_exc()
            state["drafts"][did] = {"status": "partial_error" if delivered_message_ids else "error",
                                    "error": str(e)[:300],
                                    "album_message_ids": delivered_message_ids,
                                    "photo_count": sum(map(len, delivered_message_ids))}
            # Do not retry automatically: Telegram may have accepted some messages.
            # An operator must reconcile partial delivery before resending.
            continue
        state["drafts"][did] = {"status": "sent", "slot": draft.get("slot"), "msg_id": msg["message_id"],
                                **extra, "sent_at": now().isoformat(timespec="minutes")}
        old = draft.get("revision_of")
        if old in state["drafts"] and state["drafts"][old]["status"] in ("edit_requested", "awaiting_edit", "sent"):
            state["drafts"][old]["status"] = "replaced"
        for r in requests:
            if r["id"] == draft.get("request_id"):
                r["status"] = "done"


def draw(draft):
    """Картинка к черновику: карточка (история моды, новости модных домов) или коллаж вещей."""
    if draft.get("type") in ("history", "news"):
        return render.history_card(draft["card"])
    return render.collage([it["img"] for it in draft["items"]])


def draw_all(draft):
    """Все картинки черновика: карусель образов (type "looks") — несколько слайдов, альбом (type "album") —
    готовые фото, остальное — одна."""
    if draft.get("type") == "looks":
        return render.looks_carousel(draft)
    if draft.get("type") in ("history", "news"):
        # Оригинальные тематические фото, без объединения в коллаж.
        images = []
        for spec in draft.get("card", {}).get("images", [])[:10]:
            src = next((key for key in render.SOURCES if spec.get(key)), None)
            url = render.SOURCES[src](spec[src])["url"] if src else spec["url"]
            images.append(render.photo(url, ROOT))
        if images:
            return images
        return [draw(draft)]
    if draft.get("type") == "item":
        # визуализация одной вещи: готовая студийная картинка (путь в репозитории или ссылка);
        # если есть "video", Ирине и в канал уходит видео, а картинка — превью в drafts/img/
        return [render.photo(draft["image"], ROOT)]
    if draft.get("type") == "album":
        # готовые фото как есть (до 10 — лимит альбома Telegram): пути в репозитории или ссылки
        return [render.photo(src, ROOT) for src in draft["photos"][:10]]
    if draft.get("type") not in ("history", "news") and 2 <= len(draft.get("items", [])) <= 4:
        # Товарные подборки: отдельное фото каждого товара вместо коллажа 2x2.
        return [render.photo(it["img"], ROOT) for it in draft["items"]]
    return [draw(draft)]


def preview_held(state, draft):
    """Черновик с "hold": true — только нарисовать картинку в drafts/img/, Ирине не отправлять.
    Claude смотрит картинку и снимает hold. Итог (ok или ошибка) — в state["held"]."""
    did = draft["id"]
    key = hashlib.sha1(json.dumps(draft, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]
    held = state.setdefault("held", {})
    if held.get(did, {}).get("key") == key:
        return
    try:
        save_previews(did, [render.to_jpeg(im) for im in draw_all(draft)])
        held[did] = {"key": key, "status": "preview_ready", "at": now().isoformat(timespec="minutes")}
    except Exception as e:
        traceback.print_exc()
        held[did] = {"key": key, "status": "error", "error": str(e)[:300], "at": now().isoformat(timespec="minutes")}


def save_preview(did, jpeg):
    """Копия картинки в репозитории, чтобы Claude видел, что ушло Ирине."""
    os.makedirs(os.path.join(ROOT, "drafts", "img"), exist_ok=True)
    with open(os.path.join(ROOT, "drafts", "img", f"{did}.jpg"), "wb") as f:
        f.write(jpeg)


def save_previews(did, jpegs):
    """Первое фото — drafts/img/<id>.jpg, остальные слайды карусели — <id>-2.jpg, <id>-3.jpg…"""
    save_preview(did, jpegs[0])
    for i, jpeg in enumerate(jpegs[1:], 2):
        save_preview(f"{did}-{i}", jpeg)


def backfill_previews(state):
    for did in state["drafts"]:
        p = os.path.join(ROOT, "drafts", "img", f"{did}.jpg")
        draft = load(os.path.join(ROOT, "drafts", f"{did}.json"), None)
        if os.path.exists(p) or not draft:
            continue
        try:
            save_previews(did, [render.to_jpeg(im) for im in draw_all(draft)])
        except Exception:
            traceback.print_exc()


def publish_due(state):
    t = now()
    for did, d in state["drafts"].items():
        if d["status"] != "approved" or datetime.fromisoformat(d["publish_at"]) > t:
            continue
        draft = load(os.path.join(ROOT, "drafts", f"{did}.json"), None)
        try:
            if d.get("video_file_id"):
                posted = tg.call("sendVideo", chat_id=config.CHANNEL, video=d["video_file_id"], caption=draft["text"],
                                 parse_mode="HTML", supports_streaming="true")
                d["published_message_ids"] = [posted["message_id"]]
            elif d.get("album_file_ids"):
                # Публикуем каждый образ отдельным альбомом в исходном порядке.
                posted_groups = d.setdefault("published_album_message_ids", [])
                for i, ids in enumerate(d["album_file_ids"]):
                    if i < len(posted_groups):
                        continue  # Resume without duplicating already confirmed albums.
                    look = draft["looks"][i]
                    parts = [f"<b>Образ {i + 1}. {html.escape(look.get('title', ''))}</b>"]
                    for it in look["items"]:
                        parts.append(f'<a href="{html.escape(it["url"], quote=True)}">{html.escape(it.get("short") or it["name"])}</a> — {it["price"]:,} ₽ · {html.escape(it["shop"])}')
                    media = [{"type": "photo", "media": fid} for fid in ids]
                    media[0].update(caption="\\n".join(parts), parse_mode="HTML")
                    posted = tg.call("sendMediaGroup", chat_id=config.CHANNEL, media=media)
                    if len(posted) != len(media):
                        raise RuntimeError(f"Published {len(posted)}/{len(media)} photos in look {i + 1}")
                    posted_groups.append([m["message_id"] for m in posted])
            elif d.get("file_ids"):
                media = [{"type": "photo", "media": fid} for fid in d["file_ids"]]
                media[0].update(caption=draft["text"], parse_mode="HTML")
                posted = tg.call("sendMediaGroup", chat_id=config.CHANNEL, media=media)
                if len(posted) != len(media):
                    raise RuntimeError(f"Published {len(posted)}/{len(media)} photos")
                d["published_message_ids"] = [m["message_id"] for m in posted]
            else:
                posted = tg.call("sendPhoto", chat_id=config.CHANNEL, photo=d["file_id"], caption=draft["text"],
                                 parse_mode="HTML")
                d["published_message_ids"] = [posted["message_id"]]
            d.update(status="published", published_at=t.isoformat(timespec="minutes"))
            d.pop("error", None)
            tg.call("editMessageReplyMarkup", chat_id=config.IRINA, message_id=d["msg_id"],
                    reply_markup=status_markup(f"✅ Опубликовано {t:%d.%m в %H:%M}"))
        except Exception as e:
            traceback.print_exc()
            d["error"] = str(e)[:300]


def log(*a):
    print(f"{now():%H:%M:%S}", *a, flush=True)


def git(*args):
    try:
        r = subprocess.run(["git", "-C", ROOT, *args], capture_output=True, text=True, timeout=120,
                           env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    except subprocess.TimeoutExpired:
        log("git timeout", *args)
        return subprocess.CompletedProcess(args, 1, "", "timeout")
    if r.returncode:
        log("git", *args, "->", r.returncode, (r.stderr or r.stdout)[-300:])
    return r


def pull_rebase():
    """git pull --rebase; если rebase застрял на конфликте, отменить его, чтобы репозиторий не остался посередине."""
    r = git("pull", "--rebase", "--autostash", "-X", "theirs")
    if r.returncode:
        git("rebase", "--abort")
    return r


def sync_push():
    """Сохранить состояние в репозиторий данных."""
    paths = [p for p in ("state", "data/requests.json", "data/requests", "drafts/img")
             if os.path.exists(os.path.join(ROOT, p))]
    git("add", "-A", "--", *paths)
    if git("diff", "--cached", "--quiet").returncode == 0:
        return
    git("commit", "-m", "Бот: состояние")
    pull_rebase()
    if git("push").returncode == 0:
        log("pushed")


def one_pass(state, requests, wait=0):
    n = handle_updates(state, requests, wait)
    publish_due(state)
    return n


def code_hash():
    h = hashlib.sha1()
    for p in sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), "*.py"))):
        with open(p, "rb") as f:
            h.update(f.read())
    return h.hexdigest()


def main():
    code = code_hash()
    minutes = int(os.environ.get("LOOP_MINUTES") or 0)
    stop = time.time() + minutes * 60
    last_sync = 0
    # состояние пишет только бот, поэтому держим его в памяти и лишь сохраняем
    state = load(STATE, {"offset": 0, "awaiting_edit": None, "drafts": {}})
    requests = load(REQUESTS, [])
    while True:
        if time.time() - last_sync > 60:
            log("sync")
            sync_push()
            pull_rebase()      # новые черновики от Claude
            last_sync = time.time()
            if code_hash() != code:                 # пришёл новый код бота — перезапуститься с ним
                log("restart: bot code changed")
                save(STATE, state)
                save(REQUESTS, requests)
                sync_push()
                left = max(1, int((stop - time.time()) / 60)) if minutes else 0
                os.environ["LOOP_MINUTES"] = str(left)
                os.execv(sys.executable, [sys.executable, "-u", os.path.abspath(__file__)])
            try:
                send_new_drafts(state, requests)
                backfill_previews(state)
            except Exception:
                traceback.print_exc()
            save(STATE, state)
            save(REQUESTS, requests)
            sync_push()
        try:
            changed = one_pass(state, requests, wait=25 if minutes else 0)
        except Exception:
            traceback.print_exc()
            changed = 0
            time.sleep(5)
        if changed:
            log("updates:", changed)
            save(STATE, state)
            save(REQUESTS, requests)
            sync_push()
        if not minutes or time.time() > stop:
            save(STATE, state)
            save(REQUESTS, requests)
            sync_push()
            break


if __name__ == "__main__":
    main()
