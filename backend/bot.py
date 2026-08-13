
import os
import logging

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


async def start(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE
):
    user = update.effective_user

    if not user:
        return

    username = user.username

    if username:
        telegram_name = f"@{username}"
    else:
        telegram_name = user.first_name or "Пользователь"

    await update.message.reply_text(
        "✅ Ваш Telegram-аккаунт успешно привязан к SaintBet!\n\n"
        f"Telegram: {telegram_name}\n"
        f"ID: {user.id}\n\n"
        "Теперь этот аккаунт можно использовать на сайте SaintBet."
    )


def main():

    application = (
        Application.builder()
        .token(BOT_TOKEN)
        .build()
    )

    application.add_handler(
        CommandHandler("start", start)
    )

    print("SaintBet bot started")

    application.run_polling()


if __name__ == "__main__":
    main()
