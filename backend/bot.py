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
# ХРАНИЛИЩЕ ПРИВЯЗОК
# =========================================================

links = {}

# links[code] = {
#     "telegram_id": 123456789,
#     "username": "username",
#     "first_name": "Name",
#     "created_at": 1234567890
# }


# =========================================================
# FLASK API
# =========================================================

app = Flask(__name__)


@app.route("/")
def home():
    return jsonify({
        "status": "ok",
        "service": "SaintBet Telegram Auth"
    })


@app.route("/api/link/<code>", methods=["GET"])
def get_link(code):

    data = links.get(code)

    if not data:
        return jsonify({
            "linked": False
        })

    return jsonify({
        "linked": True,
        "telegram_id": data["telegram_id"],
        "username": data["username"],
        "first_name": data["first_name"]
    })


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
        "code": code
    })


# =========================================================
# TELEGRAM
# =========================================================

async def start(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):

    user = update.effective_user

    if not user:
        return

    args = context.args

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

    # -----------------------------------------------------
    # Если пользователь пришёл просто по /start
    # -----------------------------------------------------

    if not args:

        await update.message.reply_text(
            "👋 Добро пожаловать в SaintBet!\n\n"
            "Чтобы привязать Telegram к аккаунту сайта, "
            "нажми кнопку «Войти через Telegram» на сайте."
        )

        return

    code = args[0]

    # -----------------------------------------------------
    # Проверяем код
    # -----------------------------------------------------

    if code not in links:

        await update.message.reply_text(
            "❌ Код привязки недействителен "
            "или уже истёк.\n\n"
            "Вернись на сайт SaintBet и нажми "
            "«Войти через Telegram» ещё раз."
        )

        return

    # -----------------------------------------------------
    # Сохраняем Telegram
    # -----------------------------------------------------

    links[code] = {
        "telegram_id": user.id,
        "username": username,
        "first_name": first_name,
        "created_at": time.time()
    }

    # -----------------------------------------------------
    # Ответ пользователю
    # -----------------------------------------------------

    if username:

        telegram_text = (
            f"@{username}"
        )

    else:

        telegram_text = (
            first_name or "Telegram пользователь"
        )

    await update.message.reply_text(
        "✅ АККАУНТ ПРИВЯЗАН!\n\n"
        "Ваш Telegram успешно привязан к SaintBet.\n\n"
        f"👤 Telegram: {telegram_text}\n\n"
        "Теперь можете вернуться на сайт."
    )


# =========================================================
# TELEGRAM APPLICATION
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
# START
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
