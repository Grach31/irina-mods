"""Бот канала Stambo.i. Работает в GitHub Actions почти без перерыва (LOOP_MINUTES) и сразу отвечает на кнопки.

1. Забирает сообщения и нажатия кнопок Ирины.
2. Отправляет Ирине новые черновики из drafts/ с кнопками.
3. Публикует в канал одобренные посты, когда подошло их время.
Состояние хранится в state/state.json, просьбы Ирины — в data/requests.json.
"""
import glob
import hashlib
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
                      allowed_updates=["message", "callback_query"])
    for u in updates:
        state["offset"] = u["update_id"] + 1
        try:
            if "callback_query" in u:
                on_button(state, u["callback_query"])
            elif "message" in u:
                on_message(state, requests, u["message"])
        except Exception:
            traceback.print_exc()
    return len(updates)


def on_button(state, q):
    uid = q["from"]["id"]
    if uid not in config.ALLOWED:
        tg.call("answerCallbackQuery", callback_query_id=q["id"])
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
    if uid not in config.ALLOWED or m["chat"]["type"] != "private":
        return
    text = (m.get("text") or m.get("caption") or "").strip()
    if text.startswith("/start"):
        tg.call("sendMessage", chat_id=chat, text=(
            "Привет! Я помощник канала Stambo.i 🤍\n\n"
            "Каждый день присылаю черновики постов — жми ✅, ✏️ или ❌.\n"
            "Можешь написать мне идею, например «подборка тёплых свитеров до 10 тысяч» "
            "или «пост про кожаные брюки», можно с ссылкой или фото — сделаю черновик в течение часа."))
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
    rid = f"r{m['message_id']}"
    requests.append({"id": rid, "text": text, "photos": save_photos(rid, photos),
                     "date": now().isoformat(timespec="minutes"), "status": "new"})
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
        try:
            if draft.get("type") == "history":
                img = render.history_card(draft["card"])
            else:
                img = render.collage([it["img"] for it in draft["items"]])
            jpeg = render.to_jpeg(img)
            save_preview(did, jpeg)
            msg = tg.send_photo_bytes(config.IRINA, jpeg, caption=draft["text"],
                                      reply_markup=keyboard(did, draft.get("slot")))
        except Exception as e:
            traceback.print_exc()
            state["drafts"][did] = {"status": "error", "error": str(e)[:300]}
            continue
        state["drafts"][did] = {"status": "sent", "slot": draft.get("slot"), "msg_id": msg["message_id"],
                                "file_id": msg["photo"][-1]["file_id"], "sent_at": now().isoformat(timespec="minutes")}
        old = draft.get("revision_of")
        if old in state["drafts"] and state["drafts"][old]["status"] in ("edit_requested", "awaiting_edit", "sent"):
            state["drafts"][old]["status"] = "replaced"
        for r in requests:
            if r["id"] == draft.get("request_id"):
                r["status"] = "done"


def preview_held(state, draft):
    """Черновик с "hold": true — только нарисовать картинку в drafts/img/, Ирине не отправлять.
    Claude смотрит картинку и снимает hold. Итог (ok или ошибка) — в state["held"]."""
    did = draft["id"]
    key = hashlib.sha1(json.dumps(draft, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]
    held = state.setdefault("held", {})
    if held.get(did, {}).get("key") == key:
        return
    try:
        img = render.history_card(draft["card"]) if draft.get("type") == "history" else \
            render.collage([it["img"] for it in draft["items"]])
        save_preview(did, render.to_jpeg(img))
        held[did] = {"key": key, "status": "preview_ready", "at": now().isoformat(timespec="minutes")}
    except Exception as e:
        traceback.print_exc()
        held[did] = {"key": key, "status": "error", "error": str(e)[:300], "at": now().isoformat(timespec="minutes")}


def save_preview(did, jpeg):
    """Копия картинки в репозитории, чтобы Claude видел, что ушло Ирине."""
    os.makedirs(os.path.join(ROOT, "drafts", "img"), exist_ok=True)
    with open(os.path.join(ROOT, "drafts", "img", f"{did}.jpg"), "wb") as f:
        f.write(jpeg)


def backfill_previews(state):
    for did in state["drafts"]:
        p = os.path.join(ROOT, "drafts", "img", f"{did}.jpg")
        draft = load(os.path.join(ROOT, "drafts", f"{did}.json"), None)
        if os.path.exists(p) or not draft:
            continue
        try:
            img = render.history_card(draft["card"]) if draft.get("type") == "history" else \
                render.collage([it["img"] for it in draft["items"]])
            save_preview(did, render.to_jpeg(img))
        except Exception:
            traceback.print_exc()


def publish_due(state):
    t = now()
    for did, d in state["drafts"].items():
        if d["status"] != "approved" or datetime.fromisoformat(d["publish_at"]) > t:
            continue
        draft = load(os.path.join(ROOT, "drafts", f"{did}.json"), None)
        try:
            tg.call("sendPhoto", chat_id=config.CHANNEL, photo=d["file_id"], caption=draft["text"], parse_mode="HTML")
            d.update(status="published", published_at=t.isoformat(timespec="minutes"))
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


def sync_push():
    """Сохранить состояние в репозиторий данных."""
    paths = [p for p in ("state", "data/requests.json", "data/requests", "drafts/img")
             if os.path.exists(os.path.join(ROOT, p))]
    git("add", "-A", "--", *paths)
    if git("diff", "--cached", "--quiet").returncode == 0:
        return
    git("commit", "-m", "Бот: состояние")
    git("pull", "--rebase", "--autostash", "-X", "theirs")
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
            git("pull", "--rebase", "--autostash", "-X", "theirs")      # новые черновики от Claude
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
