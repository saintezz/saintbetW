const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// =========================================================
// TELEGRAM
// =========================================================

const TELEGRAM_BOT_TOKEN =
    process.env.BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN ||
    "";

const ADMIN_CHAT_ID = String(
    process.env.ADMIN_CHAT_ID ||
    process.env.ADMIN_TELEGRAM_ID ||
    ""
).trim();

async function sendTelegramMessage(chatId, text, extra = {}) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) {
        return { ok: false, skipped: true };
    }

    try {
        const response = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    chat_id: String(chatId),
                    text,
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    ...extra
                })
            }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.ok) {
            console.error(
                "Telegram sendMessage error:",
                data
            );

            return {
                ok: false,
                error: data
            };
        }

        return {
            ok: true,
            data
        };

    } catch (error) {
        console.error(
            "Ошибка отправки Telegram:",
            error
        );

        return {
            ok: false,
            error
        };
    }
}

function escapeTelegramHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

async function notifyAdminAboutWithdrawal(withdrawal) {
    if (!ADMIN_CHAT_ID) {
        return;
    }

    const username = withdrawal.username
        ? `@${String(withdrawal.username).replace(/^@+/, "")}`
        : "без username";

    const itemName =
        withdrawal.shop_item_name ||
        `ID ${withdrawal.item_id}`;

    const text = [
        "📥 <b>НОВАЯ ЗАЯВКА НА ВЫВОД</b>",
        "",
        `👤 Telegram: <b>${escapeTelegramHtml(username)}</b>`,
        `🆔 Telegram ID: <code>${escapeTelegramHtml(withdrawal.telegram_id)}</code>`,
        `🎮 Roblox: <b>${escapeTelegramHtml(withdrawal.roblox_name)}</b>`,
        `🧠 Браинрот: <b>${escapeTelegramHtml(itemName)}</b>`,
        `⏰ Время получения: <b>${escapeTelegramHtml(withdrawal.ready_time)}</b>`,
        `💬 Комментарий: <b>${escapeTelegramHtml(withdrawal.comment || "—")}</b>`,
        `🕒 Заявка создана: <b>${escapeTelegramHtml(withdrawal.created_at || "—")}</b>`,
        "",
        `📌 ID заявки: <code>${escapeTelegramHtml(withdrawal.id)}</code>`
    ].join("\n");

    await sendTelegramMessage(
        ADMIN_CHAT_ID,
        text
    );
}

async function notifyPlayerWithdrawalAccepted(withdrawal) {
    const itemName =
        withdrawal.shop_item_name ||
        `ID ${withdrawal.item_id}`;

    const text = [
        "✅ <b>ВЫВОД ПРИНЯТ</b>",
        "",
        `🧠 Браинрот: <b>${escapeTelegramHtml(itemName)}</b>`,
        `🎮 Roblox: <b>${escapeTelegramHtml(withdrawal.roblox_name)}</b>`,
        `⏰ Время получения: <b>${escapeTelegramHtml(withdrawal.ready_time)}</b>`,
        "",
        "Администратор принял вашу заявку. Ожидайте выдачу."
    ].join("\n");

    await sendTelegramMessage(
        withdrawal.telegram_id,
        text
    );
}

// =========================================================
// DATABASE
// =========================================================

const db = new Database("database.db");

db.pragma("journal_mode = WAL");

// =========================================================
// USERS
// =========================================================

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT UNIQUE NOT NULL,
        username TEXT,
        first_name TEXT,
        roblox_name TEXT,
        balance INTEGER DEFAULT 10,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// =========================================================
// INVENTORY
// =========================================================

db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        inventory_type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// =========================================================
// WITHDRAWALS
// =========================================================

db.exec(`
    CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        roblox_name TEXT NOT NULL,
        ready_time TEXT NOT NULL,
        comment TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// =========================================================
// SHOP
// =========================================================

db.exec(`
    CREATE TABLE IF NOT EXISTS shop_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        stock INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

try {
    const shopCount = db
        .prepare("SELECT COUNT(*) AS count FROM shop_items")
        .get();

    if (shopCount && shopCount.count === 0) {
        const insertShopItem = db.prepare(`
            INSERT INTO shop_items
            (name, price, stock)
            VALUES (?, ?, ?)
        `);

        const defaultShop = [
            { name: "Ventoliero Pavonero", price: 40, stock: 2 },
            { name: "Ketchuru and Musturu", price: 40, stock: 1 },
            { name: "La Summer Grande", price: 30, stock: 2 },
            { name: "Sand Sand Sand", price: 15, stock: 2 },
            { name: "Ketupat Kepat", price: 25, stock: 2 },
            { name: "Los Tangsitos", price: 40, stock: 2 },
            { name: "Los Fruits", price: 19, stock: 1 },
            { name: "La Ginger Sekolah", price: 45, stock: 1 },
            { name: "Esok Sekolah", price: 10, stock: 1 },
            { name: "La Jolly Grande", price: 50, stock: 1 }
        ];

        for (const item of defaultShop) {
            insertShopItem.run(
                item.name,
                item.price,
                item.stock
            );
        }
    }
} catch (error) {
    console.error(
        "Ошибка инициализации магазина:",
        error
    );
}

// Добавляем новые товары без дубликатов
try {
    const insertIfMissing = db.prepare(`
        INSERT INTO shop_items
        (name, price, stock)
        SELECT ?, ?, ?
        WHERE NOT EXISTS (
            SELECT 1
            FROM shop_items
            WHERE lower(name) = lower(?)
        )
    `);

    const newBrainrots = [
        {
            name: "Cash or Card",
            price: 50,
            stock: 1
        },
        {
            name: "Burguro and Fryuro",
            price: 55,
            stock: 1
        },
        {
            name: "Cangurato Gelato",
            price: 100,
            stock: 1
        },
        {
            name: "Capitano Moby",
            price: 150,
            stock: 1
        },
        {
            name: "Meowl",
            price: 20000,
            stock: 1
        },
        {
            name: "Strawberry Elephant",
            price: 25000,
            stock: 1
        }
    ];

    for (const item of newBrainrots) {
        insertIfMissing.run(
            item.name,
            item.price,
            item.stock,
            item.name
        );
    }
} catch (error) {
    console.error(
        "Ошибка миграции новых товаров:",
        error
    );
}

// =========================================================
// PROMO DATABASE
// =========================================================

db.exec(`
    CREATE TABLE IF NOT EXISTS promo_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        reward INTEGER NOT NULL DEFAULT 0,
        max_uses INTEGER NOT NULL DEFAULT 1,
        uses INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS promo_code_uses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        promo_id INTEGER NOT NULL,
        telegram_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(promo_id, telegram_id)
    )
`);

// =========================================================
// TELEGRAM INIT DATA
// =========================================================

function validateTelegramInitData(initData) {
    const botToken = process.env.BOT_TOKEN;

    if (!botToken) {
        console.warn(
            "BOT_TOKEN не установлен."
        );

        return true;
    }

    if (!initData) {
        return false;
    }

    try {
        const params =
            new URLSearchParams(initData);

        const receivedHash =
            params.get("hash");

        if (!receivedHash) {
            return false;
        }

        params.delete("hash");

        const dataCheckString =
            [...params.entries()]
                .sort(([a], [b]) =>
                    a.localeCompare(b)
                )
                .map(
                    ([key, value]) =>
                        `${key}=${value}`
                )
                .join("\n");

        const secretKey =
            crypto
                .createHmac(
                    "sha256",
                    "WebAppData"
                )
                .update(botToken)
                .digest();

        const calculatedHash =
            crypto
                .createHmac(
                    "sha256",
                    secretKey
                )
                .update(dataCheckString)
                .digest("hex");

        return (
            calculatedHash ===
            receivedHash
        );

    } catch (error) {
        console.error(
            "Ошибка проверки Telegram:",
            error
        );

        return false;
    }
}

function getTelegramUser(initData) {
    try {
        const params =
            new URLSearchParams(initData);

        const userString =
            params.get("user");

        if (!userString) {
            return null;
        }

        return JSON.parse(
            userString
        );

    } catch (error) {
        console.error(
            "Ошибка получения Telegram пользователя:",
            error
        );

        return null;
    }
}

// =========================================================
// ADMIN AUTH
// =========================================================

function getAdminTelegramIds() {
    return String(
        process.env.ADMIN_TELEGRAM_IDS ||
        process.env.ADMIN_TELEGRAM_ID ||
        ""
    )
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);
}

function isAuthorizedAdmin(req) {
    const initData =
        req.headers["x-telegram-init-data"] ||
        req.body?.init_data ||
        req.query?.init_data ||
        "";

    const telegramUser =
        getTelegramUser(initData);

    if (
        !telegramUser ||
        !telegramUser.id
    ) {
        return false;
    }

    const allowedIds =
        getAdminTelegramIds();

    if (allowedIds.length > 0) {
        return allowedIds.includes(
            String(telegramUser.id)
        );
    }

    return (
        String(
            telegramUser.username || ""
        ).toLowerCase() ===
        "saintezz7"
    );
}

function requireAdmin(req, res) {
    if (isAuthorizedAdmin(req)) {
        return true;
    }

    res.status(403).json({
        success: false,
        error:
            "Доступ только для администратора / Admin access only"
    });

    return false;
}

// =========================================================
// MAIN
// =========================================================

app.get("/", (req, res) => {
    res.json({
        status: "ok",
        message:
            "Telegram Mini App API работает!",
        database: "ok"
    });
});

// =========================================================
// USER
// =========================================================

app.post("/api/user", (req, res) => {
    try {
        const {
            telegram_id,
            username,
            first_name,
            roblox_name
        } = req.body;

        if (!telegram_id) {
            return res.status(400).json({
                success: false,
                error:
                    "telegram_id обязателен"
            });
        }

        const telegramId =
            String(telegram_id);

        const existingUser =
            db.prepare(`
                SELECT *
                FROM users
                WHERE telegram_id = ?
            `).get(
                telegramId
            );

        if (existingUser) {
            db.prepare(`
                UPDATE users
                SET
                    username = ?,
                    first_name = ?,
                    roblox_name =
                        COALESCE(
                            ?,
                            roblox_name
                        )
                WHERE telegram_id = ?
            `).run(
                username || null,
                first_name || null,
                roblox_name || null,
                telegramId
            );
        } else {
            db.prepare(`
                INSERT INTO users (
                    telegram_id,
                    username,
                    first_name,
                    roblox_name
                )
                VALUES (?, ?, ?, ?)
            `).run(
                telegramId,
                username || null,
                first_name || null,
                roblox_name || null
            );
        }

        const user =
            db.prepare(`
                SELECT *
                FROM users
                WHERE telegram_id = ?
            `).get(
                telegramId
            );

        res.json({
            success: true,
            user
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error:
                "Ошибка сервера"
        });
    }
});

app.get(
    "/api/user/:telegram_id",
    (req, res) => {
        try {
            const telegramId =
                String(
                    req.params.telegram_id
                );

            const user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE telegram_id = ?
                `).get(
                    telegramId
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Игрок не найден"
                });
            }

            res.json({
                success: true,
                user
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

app.post(
    "/api/user/roblox",
    (req, res) => {
        try {
            const {
                telegram_id,
                roblox_name
            } = req.body;

            if (!telegram_id) {
                return res.status(400).json({
                    success: false,
                    error:
                        "telegram_id обязателен"
                });
            }

            if (
                !roblox_name ||
                !roblox_name.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Укажите Roblox ник"
                });
            }

            db.prepare(`
                UPDATE users
                SET roblox_name = ?
                WHERE telegram_id = ?
            `).run(
                roblox_name.trim(),
                String(telegram_id)
            );

            res.json({
                success: true,
                message:
                    "Roblox ник сохранён"
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// INVENTORY
// =========================================================

app.post(
    "/api/inventory/add",
    (req, res) => {
        try {
            const {
                telegram_id,
                item_id,
                inventory_type
            } = req.body;

            if (!telegram_id) {
                return res.status(400).json({
                    success: false,
                    error:
                        "telegram_id обязателен"
                });
            }

            if (
                item_id === undefined ||
                item_id === null
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "item_id обязателен"
                });
            }

            const type =
                inventory_type === "normal"
                    ? "normal"
                    : "upgrader";

            db.prepare(`
                INSERT INTO inventory (
                    telegram_id,
                    item_id,
                    inventory_type
                )
                VALUES (?, ?, ?)
            `).run(
                String(telegram_id),
                Number(item_id),
                type
            );

            res.json({
                success: true,
                message:
                    "Предмет добавлен"
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

app.get(
    "/api/inventory/:telegram_id",
    (req, res) => {
        try {
            const telegramId =
                String(
                    req.params.telegram_id
                );

            const inventory =
                db.prepare(`
                    SELECT *
                    FROM inventory
                    WHERE telegram_id = ?
                    ORDER BY id ASC
                `).all(
                    telegramId
                );

            res.json({
                success: true,
                inventory
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

app.post(
    "/api/inventory/move",
    (req, res) => {
        try {
            const {
                telegram_id,
                inventory_id
            } = req.body;

            if (
                !telegram_id ||
                !inventory_id
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Не хватает данных"
                });
            }

            const item =
                db.prepare(`
                    SELECT *
                    FROM inventory
                    WHERE id = ?
                      AND telegram_id = ?
                      AND inventory_type =
                          'upgrader'
                `).get(
                    Number(inventory_id),
                    String(telegram_id)
                );

            if (!item) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Предмет не найден"
                });
            }

            db.prepare(`
                UPDATE inventory
                SET inventory_type = 'normal'
                WHERE id = ?
                  AND telegram_id = ?
            `).run(
                Number(inventory_id),
                String(telegram_id)
            );

            res.json({
                success: true,
                message:
                    "Предмет выведен в обычный инвентарь"
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

app.post(
    "/api/inventory/sell",
    (req, res) => {
        try {
            const {
                telegram_id,
                inventory_id,
                price
            } = req.body;

            if (
                !telegram_id ||
                !inventory_id
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Не хватает данных"
                });
            }

            const item =
                db.prepare(`
                    SELECT *
                    FROM inventory
                    WHERE id = ?
                      AND telegram_id = ?
                      AND inventory_type =
                          'upgrader'
                `).get(
                    Number(inventory_id),
                    String(telegram_id)
                );

            if (!item) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Предмет не найден"
                });
            }

            const sellPrice =
                Number(price) || 0;

            const transaction =
                db.transaction(() => {

                    db.prepare(`
                        DELETE FROM inventory
                        WHERE id = ?
                          AND telegram_id = ?
                    `).run(
                        Number(inventory_id),
                        String(telegram_id)
                    );

                    db.prepare(`
                        UPDATE users
                        SET balance =
                            balance + ?
                        WHERE telegram_id = ?
                    `).run(
                        sellPrice,
                        String(telegram_id)
                    );
                });

            transaction();

            res.json({
                success: true,
                message:
                    "Предмет продан",
                received:
                    sellPrice
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// WITHDRAWALS
// =========================================================

app.post(
    "/api/withdrawals",
    async (req, res) => {

        try {
            const {
                telegram_id,
                inventory_id,
                item_id,
                roblox_name,
                ready_time,
                comment
            } = req.body;

            if (!telegram_id) {
                return res.status(400).json({
                    success: false,
                    error:
                        "telegram_id обязателен"
                });
            }

            if (
                !item_id &&
                !inventory_id
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Не указан предмет"
                });
            }

            if (
                !roblox_name ||
                !roblox_name.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Укажите Roblox ник"
                });
            }

            if (
                !ready_time ||
                !ready_time.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Укажите время"
                });
            }

            const telegramId =
                String(telegram_id);

            let finalItemId = item_id;

            if (inventory_id) {

                const inventoryItem =
                    db.prepare(`
                        SELECT *
                        FROM inventory
                        WHERE id = ?
                          AND telegram_id = ?
                          AND inventory_type =
                              'upgrader'
                    `).get(
                        Number(inventory_id),
                        telegramId
                    );

                if (!inventoryItem) {
                    return res.status(404).json({
                        success: false,
                        error:
                            "Предмет не найден в инвентаре апгрейдера"
                    });
                }

                finalItemId =
                    inventoryItem.item_id;

                db.prepare(`
                    UPDATE inventory
                    SET inventory_type =
                        'normal'
                    WHERE id = ?
                      AND telegram_id = ?
                `).run(
                    Number(inventory_id),
                    telegramId
                );
            }

            const result =
                db.prepare(`
                    INSERT INTO withdrawals (
                        telegram_id,
                        item_id,
                        roblox_name,
                        ready_time,
                        comment
                    )
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    telegramId,
                    Number(finalItemId),
                    roblox_name.trim(),
                    ready_time.trim(),
                    comment
                        ? comment.trim()
                        : null
                );

            const withdrawal =
                db.prepare(`
                    SELECT
                        withdrawals.*,
                        users.username,
                        users.first_name,
                        shop_items.name AS shop_item_name,
                        shop_items.price AS shop_item_price
                    FROM withdrawals
                    LEFT JOIN users
                        ON users.telegram_id =
                           withdrawals.telegram_id
                    LEFT JOIN shop_items
                        ON shop_items.id =
                           withdrawals.item_id
                    WHERE withdrawals.id = ?
                `).get(
                    Number(
                        result.lastInsertRowid
                    )
                );

            await notifyAdminAboutWithdrawal(
                withdrawal
            );

            res.json({
                success: true,
                withdrawal_id:
                    result.lastInsertRowid,
                message:
                    "Заявка на вывод создана"
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

app.get(
    "/api/withdrawals/:telegram_id",
    (req, res) => {
        try {
            const telegramId =
                String(
                    req.params.telegram_id
                );

            const withdrawals =
                db.prepare(`
                    SELECT *
                    FROM withdrawals
                    WHERE telegram_id = ?
                    ORDER BY id DESC
                `).all(
                    telegramId
                );

            res.json({
                success: true,
                withdrawals
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// ADMIN WITHDRAWALS
// =========================================================

app.get(
    "/api/admin/withdrawals",
    (req, res) => {

        try {

            if (!requireAdmin(req, res)) {
                return;
            }

            const withdrawals =
                db.prepare(`
                    SELECT
                        withdrawals.*,
                        users.username,
                        users.first_name,
                        shop_items.name AS shop_item_name,
                        shop_items.price AS shop_item_price
                    FROM withdrawals
                    LEFT JOIN users
                        ON users.telegram_id =
                           withdrawals.telegram_id
                    LEFT JOIN shop_items
                        ON shop_items.id =
                           withdrawals.item_id
                    ORDER BY withdrawals.id DESC
                `).all();

            res.json({
                success: true,
                withdrawals
            });

        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

app.post(
    "/api/admin/withdrawals/status",
    async (req, res) => {

        try {

            if (!requireAdmin(req, res)) {
                return;
            }

            const {
                withdrawal_id,
                status
            } = req.body;

            const allowedStatuses = [
                "pending",
                "processing",
                "completed",
                "rejected"
            ];

            if (!withdrawal_id) {
                return res.status(400).json({
                    success: false,
                    error:
                        "withdrawal_id обязателен"
                });
            }

            if (
                !allowedStatuses.includes(
                    status
                )
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Недопустимый статус"
                });
            }

            const withdrawal =
                db.prepare(`
                    SELECT
                        withdrawals.*,
                        users.username,
                        users.first_name,
                        shop_items.name AS shop_item_name,
                        shop_items.price AS shop_item_price
                    FROM withdrawals
                    LEFT JOIN users
                        ON users.telegram_id =
                           withdrawals.telegram_id
                    LEFT JOIN shop_items
                        ON shop_items.id =
                           withdrawals.item_id
                    WHERE withdrawals.id = ?
                `).get(
                    Number(
                        withdrawal_id
                    )
                );

            if (!withdrawal) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Заявка не найдена"
                });
            }

            const oldStatus =
                withdrawal.status;

            db.prepare(`
                UPDATE withdrawals
                SET status = ?
                WHERE id = ?
            `).run(
                status,
                Number(withdrawal_id)
            );

            if (
                status === "completed" &&
                oldStatus !== "completed"
            ) {
                await notifyPlayerWithdrawalAccepted(
                    {
                        ...withdrawal,
                        status
                    }
                );
            }

            res.json({
                success: true,
                message:
                    status === "completed"
                        ? "Вывод принят, игрок уведомлён"
                        : "Статус изменён"
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// ADMIN USERS
// =========================================================

app.get(
    "/api/admin/users",
    (req, res) => {

        try {

            if (!requireAdmin(req, res)) {
                return;
            }

            const users =
                db.prepare(`
                    SELECT *
                    FROM users
                    ORDER BY id DESC
                `).all();

            res.json({
                success: true,
                users
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// ADMIN GRANT BONES
// =========================================================

app.post(
    "/api/admin/grant-bones",
    (req, res) => {

        try {

            if (!requireAdmin(req, res)) {
                return;
            }

            const {
                username,
                amount
            } = req.body;

            const normalizedUsername =
                String(
                    username || ""
                )
                    .trim()
                    .replace(/^@+/, "")
                    .toLowerCase();

            const value =
                Math.floor(
                    Number(amount)
                );

            if (!normalizedUsername) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Укажите Telegram username"
                });
            }

            if (
                !Number.isFinite(value) ||
                value < 1
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Количество костей должно быть больше 0"
                });
            }

            const user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE lower(
                        replace(
                            coalesce(
                                username,
                                ''
                            ),
                            '@',
                            ''
                        )
                    ) = ?
                    LIMIT 1
                `).get(
                    normalizedUsername
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Игрок не найден"
                });
            }

            db.prepare(`
                UPDATE users
                SET balance =
                    balance + ?
                WHERE telegram_id = ?
            `).run(
                value,
                user.telegram_id
            );

            const updated =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE telegram_id = ?
                `).get(
                    user.telegram_id
                );

            res.json({
                success: true,
                user: updated,
                message:
                    `Выдано ${value} 🦴 пользователю @${normalizedUsername}`
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// BALANCE SYNC
// =========================================================

app.post(
    "/api/user/balance",
    (req, res) => {

        try {

            const {
                telegram_id,
                balance
            } = req.body;

            const telegramId =
                String(
                    telegram_id || ""
                ).trim();

            const newBalance =
                Math.max(
                    0,
                    Math.floor(
                        Number(balance)
                    )
                );

            if (!telegramId) {
                return res.status(400).json({
                    success: false,
                    error:
                        "telegram_id обязателен"
                });
            }

            if (
                !Number.isFinite(
                    newBalance
                )
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Некорректный баланс"
                });
            }

            const result =
                db.prepare(`
                    UPDATE users
                    SET balance = ?
                    WHERE telegram_id = ?
                `).run(
                    newBalance,
                    telegramId
                );

            if (!result.changes) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Игрок не найден"
                });
            }

            const user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE telegram_id = ?
                `).get(
                    telegramId
                );

            res.json({
                success: true,
                balance:
                    user.balance,
                user
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// PROMO - PLAYER REDEEM
// =========================================================

app.post(
    "/api/promo/redeem",
    (req, res) => {

        try {

            const {
                telegram_id,
                code
            } = req.body;

            const telegramId =
                String(
                    telegram_id || ""
                ).trim();

            const promoCode =
                String(
                    code || ""
                )
                    .trim()
                    .toUpperCase();

            if (
                !telegramId ||
                !promoCode
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Введите промокод / Enter promo code"
                });
            }

            const user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE telegram_id = ?
                `).get(
                    telegramId
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Игрок не найден / Player not found"
                });
            }

            const promo =
                db.prepare(`
                    SELECT *
                    FROM promo_codes
                    WHERE code = ?
                      AND active = 1
                `).get(
                    promoCode
                );

            if (!promo) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Промокод не найден или отключён / Promo code not found or disabled"
                });
            }

            if (
                promo.uses >=
                promo.max_uses
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Лимит активаций промокода исчерпан / Promo code usage limit reached"
                });
            }

            const alreadyUsed =
                db.prepare(`
                    SELECT id
                    FROM promo_code_uses
                    WHERE promo_id = ?
                      AND telegram_id = ?
                `).get(
                    promo.id,
                    telegramId
                );

            if (alreadyUsed) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Вы уже использовали этот промокод / You already used this promo code"
                });
            }

            const tx =
                db.transaction(() => {

                    db.prepare(`
                        UPDATE users
                        SET balance =
                            balance + ?
                        WHERE telegram_id = ?
                    `).run(
                        promo.reward,
                        telegramId
                    );

                    db.prepare(`
                        UPDATE promo_codes
                        SET uses =
                            uses + 1
                        WHERE id = ?
                    `).run(
                        promo.id
                    );

                    db.prepare(`
                        INSERT INTO promo_code_uses (
                            promo_id,
                            telegram_id
                        )
                        VALUES (?, ?)
                    `).run(
                        promo.id,
                        telegramId
                    );
                });

            tx();

            const updated =
                db.prepare(`
                    SELECT balance
                    FROM users
                    WHERE telegram_id = ?
                `).get(
                    telegramId
                );

            res.json({
                success: true,
                reward:
                    promo.reward,
                balance:
                    updated.balance,
                message:
                    `Промокод активирован! +${promo.reward} 🦴 / Promo code activated! +${promo.reward} 🦴`
            });

        } catch (error) {

            console.error(
                "Ошибка активации промокода:",
                error
            );

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера / Server error"
            });
        }
    }
);

// =========================================================
// ADMIN PROMOS - LIST
// =========================================================

app.get(
    "/api/admin/promo-codes",
    (req, res) => {

        try {

            if (!requireAdmin(req, res)) {
                return;
            }

            const promoCodes =
                db.prepare(`
                    SELECT *
                    FROM promo_codes
                    ORDER BY id DESC
                `).all();

            res.json({
                success: true,
                promoCodes
            });

        } catch (error) {

            console.error(
                "Ошибка получения промокодов:",
                error
            );

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// ADMIN PROMOS - CREATE
// =========================================================

app.post(
    "/api/admin/promo-codes",
    (req, res) => {

        try {

            if (!requireAdmin(req, res)) {
                return;
            }

            const {
                code,
                reward,
                max_uses
            } = req.body;

            const normalizedCode =
                String(
                    code || ""
                )
                    .trim()
                    .toUpperCase()
                    .replace(
                        /\s+/g,
                        ""
                    );

            const promoReward =
                Math.floor(
                    Number(reward)
                );

            const maxUses =
                Math.floor(
                    Number(max_uses)
                );

            if (
                !/^[A-Z0-9_-]{3,32}$/.test(
                    normalizedCode
                )
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Промокод должен содержать 3–32 символа / Code must contain 3–32 characters"
                });
            }

            if (
                !Number.isFinite(
                    promoReward
                ) ||
                promoReward < 1
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Награда должна быть больше 0 / Reward must be greater than 0"
                });
            }

            if (
                !Number.isFinite(
                    maxUses
                ) ||
                maxUses < 1
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Количество активаций должно быть больше 0 / Max uses must be greater than 0"
                });
            }

            const result =
                db.prepare(`
                    INSERT INTO promo_codes (
                        code,
                        reward,
                        max_uses
                    )
                    VALUES (?, ?, ?)
                `).run(
                    normalizedCode,
                    promoReward,
                    maxUses
                );

            const promo =
                db.prepare(`
                    SELECT *
                    FROM promo_codes
                    WHERE id = ?
                `).get(
                    result.lastInsertRowid
                );

            res.json({
                success: true,
                promoCode:
                    promo,
                message:
                    "Промокод создан / Promo code created"
            });

        } catch (error) {

            console.error(
                "Ошибка создания промокода:",
                error
            );

            if (
                String(
                    error.message || ""
                ).includes("UNIQUE")
            ) {
                return res.status(409).json({
                    success: false,
                    error:
                        "Такой промокод уже существует / Promo code already exists"
                });
            }

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// ADMIN PROMOS - STATUS
// =========================================================

app.post(
    "/api/admin/promo-codes/status",
    (req, res) => {

        try {

            if (!requireAdmin(req, res)) {
                return;
            }

            const {
                promo_id,
                active
            } = req.body;

            const result =
                db.prepare(`
                    UPDATE promo_codes
                    SET active = ?
                    WHERE id = ?
                `).run(
                    active ? 1 : 0,
                    Number(promo_id)
                );

            if (!result.changes) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Промокод не найден / Promo code not found"
                });
            }

            res.json({
                success: true,
                message:
                    "Статус изменён / Status changed"
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// ADMIN PROMOS - DELETE
// =========================================================

app.delete(
    "/api/admin/promo-codes/:id",
    (req, res) => {

        try {

            if (!requireAdmin(req, res)) {
                return;
            }

            const promoId =
                Number(
                    req.params.id
                );

            const transaction =
                db.transaction(() => {

                    db.prepare(`
                        DELETE FROM promo_code_uses
                        WHERE promo_id = ?
                    `).run(
                        promoId
                    );

                    return db.prepare(`
                        DELETE FROM promo_codes
                        WHERE id = ?
                    `).run(
                        promoId
                    );
                });

            const result =
                transaction();

            if (!result.changes) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Промокод не найден / Promo code not found"
                });
            }

            res.json({
                success: true,
                message:
                    "Промокод удалён / Promo code deleted"
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// SHOP API
// =========================================================

app.get(
    "/api/shop/items",
    (req, res) => {

        try {

            const items =
                db.prepare(`
                    SELECT *
                    FROM shop_items
                    ORDER BY price ASC, id ASC
                `).all();

            res.json({
                success: true,
                items
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// ADMIN SHOP - ADD
// =========================================================

app.post(
    "/api/shop/items",
    (req, res) => {

        try {

            if (!requireAdmin(req, res)) {
                return;
            }

            const {
                name,
                price,
                stock
            } = req.body;

            if (
                !name ||
                !name.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Укажите название браинрота"
                });
            }

            const itemPrice =
                Number(price);

            const itemStock =
                Number(
                    stock !== undefined
                        ? stock
                        : 1
                );

            if (
                !Number.isFinite(
                    itemPrice
                ) ||
                itemPrice < 0
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Укажите корректную цену"
                });
            }

            if (
                !Number.isFinite(
                    itemStock
                ) ||
                itemStock < 0
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Укажите корректный остаток"
                });
            }

            const result =
                db.prepare(`
                    INSERT INTO shop_items (
                        name,
                        price,
                        stock
                    )
                    VALUES (?, ?, ?)
                `).run(
                    name.trim(),
                    itemPrice,
                    itemStock
                );

            const newItem =
                db.prepare(`
                    SELECT *
                    FROM shop_items
                    WHERE id = ?
                `).get(
                    result.lastInsertRowid
                );

            res.json({
                success: true,
                item:
                    newItem,
                message:
                    "Браинрот добавлен в магазин"
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// ADMIN SHOP - UPDATE
// =========================================================

app.put(
    "/api/shop/items/:id",
    (req, res) => {

        try {

            if (!requireAdmin(req, res)) {
                return;
            }

            const itemId =
                Number(
                    req.params.id
                );

            const {
                name,
                price,
                stock
            } = req.body;

            const existing =
                db.prepare(`
                    SELECT *
                    FROM shop_items
                    WHERE id = ?
                `).get(
                    itemId
                );

            if (!existing) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Товар не найден"
                });
            }

            const newName =
                name !== undefined
                    ? String(name).trim()
                    : existing.name;

            const newPrice =
                price !== undefined
                    ? Number(price)
                    : existing.price;

            const newStock =
                stock !== undefined
                    ? Number(stock)
                    : existing.stock;

            if (
                !newName ||
                !Number.isFinite(
                    newPrice
                ) ||
                newPrice < 0 ||
                !Number.isFinite(
                    newStock
                ) ||
                newStock < 0
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Некорректные данные"
                });
            }

            db.prepare(`
                UPDATE shop_items
                SET
                    name = ?,
                    price = ?,
                    stock = ?
                WHERE id = ?
            `).run(
                newName,
                newPrice,
                newStock,
                itemId
            );

            const updatedItem =
                db.prepare(`
                    SELECT *
                    FROM shop_items
                    WHERE id = ?
                `).get(
                    itemId
                );

            res.json({
                success: true,
                item:
                    updatedItem,
                message:
                    "Товар обновлён"
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// ADMIN SHOP - DELETE
// =========================================================

app.delete(
    "/api/shop/items/:id",
    (req, res) => {

        try {

            if (!requireAdmin(req, res)) {
                return;
            }

            const itemId =
                Number(
                    req.params.id
                );

            const result =
                db.prepare(`
                    DELETE FROM shop_items
                    WHERE id = ?
                `).run(
                    itemId
                );

            if (!result.changes) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Товар не найден"
                });
            }

            res.json({
                success: true,
                message:
                    "Предложение удалено из магазина"
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// SHOP WITHDRAW
// =========================================================

app.post(
    "/api/shop/withdraw",
    async (req, res) => {

        try {

            const {
                telegram_id,
                shop_item_id,
                roblox_name,
                ready_time,
                comment
            } = req.body;

            if (
                !telegram_id ||
                !shop_item_id
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "telegram_id и shop_item_id обязательны"
                });
            }

            if (
                !roblox_name ||
                !roblox_name.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Укажите Roblox ник"
                });
            }

            if (
                !ready_time ||
                !ready_time.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Укажите время получения"
                });
            }

            const telegramId =
                String(telegram_id);

            const item =
                db.prepare(`
                    SELECT *
                    FROM shop_items
                    WHERE id = ?
                `).get(
                    Number(
                        shop_item_id
                    )
                );

            if (!item) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Товар не найден в магазине"
                });
            }

            if (item.stock < 1) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Этого браинрота нет в наличии на складе"
                });
            }

            const user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE telegram_id = ?
                `).get(
                    telegramId
                );

            if (
                !user ||
                user.balance < item.price
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Недостаточно костей для вывода"
                });
            }

            const tx =
                db.transaction(() => {

                    db.prepare(`
                        UPDATE users
                        SET
                            balance =
                                balance - ?,
                            roblox_name =
                                COALESCE(
                                    ?,
                                    roblox_name
                                )
                        WHERE telegram_id = ?
                    `).run(
                        item.price,
                        roblox_name.trim(),
                        telegramId
                    );

                    db.prepare(`
                        UPDATE shop_items
                        SET stock =
                            stock - 1
                        WHERE id = ?
                    `).run(
                        item.id
                    );

                    const commentText =
                        `Магазин: ${item.name}${
                            comment &&
                            comment.trim()
                                ? " | " +
                                  comment.trim()
                                : ""
                        }`;

                    const result =
                        db.prepare(`
                            INSERT INTO withdrawals (
                                telegram_id,
                                item_id,
                                roblox_name,
                                ready_time,
                                comment
                            )
                            VALUES (?, ?, ?, ?, ?)
                        `).run(
                            telegramId,
                            item.id,
                            roblox_name.trim(),
                            ready_time.trim(),
                            commentText
                        );

                    return result.lastInsertRowid;
                });

            const withdrawalId =
                tx();

            const updatedUser =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE telegram_id = ?
                `).get(
                    telegramId
                );

            const updatedItem =
                db.prepare(`
                    SELECT *
                    FROM shop_items
                    WHERE id = ?
                `).get(
                    item.id
                );

            const withdrawal =
                db.prepare(`
                    SELECT
                        withdrawals.*,
                        users.username,
                        users.first_name,
                        shop_items.name AS shop_item_name,
                        shop_items.price AS shop_item_price
                    FROM withdrawals
                    LEFT JOIN users
                        ON users.telegram_id =
                           withdrawals.telegram_id
                    LEFT JOIN shop_items
                        ON shop_items.id =
                           withdrawals.item_id
                    WHERE withdrawals.id = ?
                `).get(
                    Number(
                        withdrawalId
                    )
                );

            await notifyAdminAboutWithdrawal(
                withdrawal
            );

            res.json({
                success: true,
                withdrawal_id:
                    withdrawalId,
                user:
                    updatedUser,
                item:
                    updatedItem,
                message:
                    `Заявка на вывод ${item.name} успешно создана!`
            });

        } catch (error) {

            console.error(
                "Ошибка вывода товара:",
                error
            );

            res.status(500).json({
                success: false,
                error:
                    "Ошибка сервера"
            });
        }
    }
);

// =========================================================
// ERROR HANDLER
// =========================================================

app.use(
    (error, req, res, next) => {

        console.error(error);

        res.status(500).json({
            success: false,
            error:
                "Внутренняя ошибка сервера"
        });
    }
);

// =========================================================
// START
// =========================================================

const PORT =
    process.env.PORT ||
    3000;

app.listen(
    PORT,
    () => {
        console.log(
            `Server started on port ${PORT}`
        );
    }
);
