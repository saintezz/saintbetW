import os
import time
import secrets
import threading
import logging

from flask import Flask, jsonify
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
)

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)

BOT_TOKEN = os.environ.get("BOT_TOKEN")

if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN не задан")


# =========================================================
# НАСТРОЙКИ
# =========================================================

BOT_USERNAME = "saintbetWbot"

# Сколько живёт код привязки
CODE_LIFETIME = 10 * 60


# =========================================================
# ХРАНИЛИЩЕ КОДОВ
# =========================================================

links = {}

# links[code] = {
#     "telegram_id": None,
#     "username": "",
#     "first_name": "",
#     "created_at": 1234567890
# }


# =========================================================
# FLASK
# =========================================================

app = Flask(__name__)


@app.route("/")
def home():

    return jsonify({
        "status": "ok",
        "service": "SaintBet Telegram Auth"
    })


# =========================================================
# СОЗДАТЬ КОД
# =========================================================

@app.route("/api/create-code", methods=["GET"])
def create_code():

    code = secrets.token_urlsafe(24)

    links[code] = {
        "telegram_id": None,
        "username": "",
        "first_name": "",
        "created_at": time.time()
    }

    return jsonify({
        "success": True,
        "code": code,
        "bot_url": f"https://t.me/{BOT_USERNAME}?start={code}"
    })


# =========================================================
# ПРОВЕРИТЬ КОД
# =========================================================

@app.route("/api/link/<code>", methods=["GET"])
def get_link(code):

    data = links.get(code)

    if not data:

        return jsonify({
            "linked": False
        })


    # Проверяем срок действия кода

    if time.time() - data["created_at"] > CODE_LIFETIME:

        links.pop(code, None)

        return jsonify({
            "linked": False,
            "expired": True
        })


    # Telegram ещё не привязан

    if not data["telegram_id"]:

        return jsonify({
            "linked": False
        })


    return jsonify({
        "linked": True,
        "telegram_id": data["telegram_id"],
        "username": data["username"],
        "first_name": data["first_name"]
    })


# =========================================================
# TELEGRAM /START
# =========================================================

async def start(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):

    user = update.effective_user

    if not user:
        return


    username = (
        user.username
        if user.username
        else ""
    )

    first_name = (
        user.first_name
        if user.first_name
        else ""
    )


    # =====================================================
    # ПРОСТОЙ /START БЕЗ КОДА
    # =====================================================

    if not context.args:

        await update.message.reply_text(
            "👋 Добро пожаловать в SaintBet!\n\n"
            "Чтобы привязать Telegram к сайту, "
            "открой SaintBet и нажми "
            "«ВОЙТИ ЧЕРЕЗ TELEGRAM»."
        )

        return


    # =====================================================
    # ПОЛУЧАЕМ КОД
    # =====================================================

    code = context.args[0]

    data = links.get(code)


    if not data:

        await update.message.reply_text(
            "❌ Код привязки недействителен.\n\n"
            "Вернись на сайт SaintBet и "
            "нажми «ВОЙТИ ЧЕРЕЗ TELEGRAM» ещё раз."
        )

        return


    # =====================================================
    # ПРОВЕРЯЕМ СРОК
    # =====================================================

    if time.time() - data["created_at"] > CODE_LIFETIME:

        links.pop(code, None)

        await update.message.reply_text(
            "❌ Код привязки истёк.\n\n"
            "Вернись на сайт SaintBet и "
            "создай новую привязку."
        )

        return


    # =====================================================
    # СОХРАНЯЕМ TELEGRAM
    # =====================================================

    links[code] = {

        "telegram_id": user.id,

        "username": username,

        "first_name": first_name,

        "created_at": data["created_at"]

    }


    # =====================================================
    # ОТОБРАЖАЕМ ИМЯ
    # =====================================================

    if username:

        telegram_name = "@" + username

    else:

        telegram_name = (
            first_name
            or "Telegram пользователь"
        )


    # =====================================================
    # ОТВЕТ
    # =====================================================

    await update.message.reply_text(

        "✅ АККАУНТ ПРИВЯЗАН!\n\n"

        "Ваш Telegram аккаунт успешно "
        "привязан к SaintBet.\n\n"

        f"👤 Telegram: {telegram_name}\n\n"

        "Теперь вернитесь на сайт.\n"
        "Через несколько секунд ваш аккаунт "
        "отобразится в профиле."
    )


# =========================================================
# ЗАПУСК TELEGRAM
# =========================================================

def run_bot():

    application = (
        Application.builder()
        .token(BOT_TOKEN)
        .build()
    )

    application.add_handler(
        CommandHandler(
            "start",
            start
        )
    )

    logging.info(
        "SaintBet Telegram bot started"
    )

    application.run_polling()


# =========================================================
# ЗАПУСК SERVER
# =========================================================

if __name__ == "__main__":

    port = int(
        os.environ.get(
            "PORT",
            "10000"
        )
    )


    bot_thread = threading.Thread(
        target=run_bot,
        daemon=True
    )

    bot_thread.start()


    logging.info(
        "SaintBet API started on port %s",
        port
    )


    app.run(
        host="0.0.0.0",
        port=port
    )
