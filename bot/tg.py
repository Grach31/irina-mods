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


def download_file(file_id):
    info = call("getFile", file_id=file_id)
    url = f"https://api.telegram.org/file/bot{_token()}/{info['file_path']}"
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()
