"""Safe Telegram Mini App actions received through web_app_data messages."""
import json

def handle(state, message, tg, config, now):
    uid = message.get("from", {}).get("id")
    chat_id = message.get("chat", {}).get("id")
    if uid not in config.ALLOWED or uid in config.READ_ONLY or message.get("chat", {}).get("type") != "private":
        tg.call("sendMessage", chat_id=chat_id, text="Доступ только для просмотра. Публикация недоступна.")
        return
    try:
        payload = json.loads(message.get("web_app_data", {}).get("data", ""))
    except (ValueError, TypeError):
        tg.call("sendMessage", chat_id=chat_id, text="Некорректная команда Mini App.")
        return
    if not isinstance(payload, dict) or payload.get("type") != "stambo_miniapp":
        return
    action = payload.get("action")
    did = payload.get("id")
    if action not in ("ok", "no", "edit") or not isinstance(did, str) or len(did) > 100:
        tg.call("sendMessage", chat_id=chat_id, text="Неизвестная команда приложения.")
        return
    d = state.get("drafts", {}).get(did)
    if not d or d.get("status") != "sent":
        tg.call("sendMessage", chat_id=chat_id, text="Этот черновик уже обработан или недоступен.")
        return
    if action == "ok":
        # This reuses the existing approved -> publish_due pipeline.
        d["status"] = "approved"
        d["publish_at"] = now().isoformat()
        tg.call("sendMessage", chat_id=chat_id, text="✅ Пост одобрен. Бот отправит его в канал.")
    elif action == "no":
        d["status"] = "rejected"
        tg.call("sendMessage", chat_id=chat_id, text="❌ Черновик отклонён.")
        try:
            tg.call("editMessageReplyMarkup", chat_id=config.IRINA,
                    message_id=d["msg_id"], reply_markup={
                        "inline_keyboard": [[{"text": "❌ Не публикуем", "callback_data": "noop"}]]})
        except Exception:
            pass
    elif action == "edit":
        d["status"] = "awaiting_edit"
        state["awaiting_edit"] = did
        tg.call("sendMessage", chat_id=chat_id, text=(
            "✏️ Отправь одним сообщением, что изменить в посте " + did + ". "
            "Подготовлю исправленную версию."
        ))
