"""Настройки бота. Номера чатов лежат в закрытом репозитории данных (config.json), не здесь."""
import json
import os
from datetime import timedelta, timezone

DATA = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"))
_cfg = json.load(open(os.path.join(DATA, "config.json"), encoding="utf-8"))

IRINA = int(_cfg["irina"])            # чат Ирины с ботом: черновики и её просьбы
CHANNEL = int(_cfg["channel"])        # канал Stambo.i
ALLOWED = {int(x) for x in _cfg.get("allowed", [IRINA])}
MSK = timezone(timedelta(hours=3))
LAST_HOUR = 21
MORNING_SLOT = "10:00"
