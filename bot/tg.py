"""Минимальная обёртка над Telegram Bot API."""
import json
import os
import urllib.parse
import urllib.request
import uuid

API = "https://api.telegram.org/bot{}/{}"


def _token():
    return os.environ["TELEGRAM_TOKEN"]


def call(method, **params):
    data = {k: (json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v)
            for k, v in params.items() if v is not None}
    req = urllib.request.Request(API.format(_token(), method), data=urllib.parse.urlencode(data).encode())
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.load(r)
    if not res.get("ok"):
        raise RuntimeError(f"{method}: {res}")
    return res["result"]


def send_photo_bytes(chat_id, jpeg, caption=None, reply_markup=None):
    boundary = uuid.uuid4().hex
    fields = {"chat_id": str(chat_id), "parse_mode": "HTML"}
    if caption:
        fields["caption"] = caption
    if reply_markup:
        fields["reply_markup"] = json.dumps(reply_markup, ensure_ascii=False)
    body = b""
    for k, v in fields.items():
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"post.jpg\"\r\n"
             f"Content-Type: image/jpeg\r\n\r\n").encode() + jpeg + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(API.format(_token(), "sendPhoto"), data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        res = json.load(r)
    if not res.get("ok"):
        raise RuntimeError(f"sendPhoto: {res}")
    return res["result"]


def fetch(url, limit=48 * 1024 * 1024):
    """Скачать файл по ссылке (видео для поста); не больше лимита Telegram для ботов (50 МБ)."""
    req = urllib.request.Request(url, headers={"User-Agent": "StamboBot/1.0 (github.com/Grach31/irina-mods)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise RuntimeError("файл больше 48 МБ")
    return data


def send_video_bytes(chat_id, video, caption=None, reply_markup=None):
    """Видео (mp4) с подписью и кнопками. Возвращает сообщение; file_id — в result["video"]["file_id"]."""
    boundary = uuid.uuid4().hex
    fields = {"chat_id": str(chat_id), "parse_mode": "HTML", "supports_streaming": "true"}
    if caption:
        fields["caption"] = caption
    if reply_markup:
        fields["reply_markup"] = json.dumps(reply_markup, ensure_ascii=False)
    body = b""
    for k, v in fields.items():
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"video\"; filename=\"post.mp4\"\r\n"
             f"Content-Type: video/mp4\r\n\r\n").encode() + video + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(API.format(_token(), "sendVideo"), data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=300) as r:
        res = json.load(r)
    if not res.get("ok"):
        raise RuntimeError(f"sendVideo: {res}")
    return res["result"]


def download_file(file_id):
    info = call("getFile", file_id=file_id)
    url = f"https://api.telegram.org/file/bot{_token()}/{info['file_path']}"
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def send_media_group_bytes(chat_id, jpegs, caption=None):
    """Альбом (карусель) из 2–10 фото; подпись — у первого фото. Возвращает список сообщений."""
    boundary = uuid.uuid4().hex
    media = []
    for i in range(len(jpegs)):
        m = {"type": "photo", "media": f"attach://p{i}"}
        if i == 0 and caption:
            m.update(caption=caption, parse_mode="HTML")
        media.append(m)
    body = b""
    for k, v in {"chat_id": str(chat_id), "media": json.dumps(media, ensure_ascii=False)}.items():
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    for i, jpeg in enumerate(jpegs):
        body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"p{i}\"; filename=\"p{i}.jpg\"\r\n"
                 f"Content-Type: image/jpeg\r\n\r\n").encode() + jpeg + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(API.format(_token(), "sendMediaGroup"), data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=180) as r:
        res = json.load(r)
    if not res.get("ok"):
        raise RuntimeError(f"sendMediaGroup: {res}")
    return res["result"]
