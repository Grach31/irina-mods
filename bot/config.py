"""Настройки бота канала Stambo.i."""
from datetime import timedelta, timezone

IRINA = 880098519            # чат Ирины с ботом: черновики и её просьбы
CHANNEL = -1001781492500     # канал Stambo.i
ALLOWED = {IRINA}            # от кого бот принимает просьбы и нажатия кнопок
MSK = timezone(timedelta(hours=3))
LAST_HOUR = 21               # позже этого часа в канал не публикуем, переносим на утро
MORNING_SLOT = "10:00"
