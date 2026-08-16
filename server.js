const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const db = new Database("database.sqlite");

db.pragma("journal_mode = WAL");

// =========================================================
// DATABASE
// =========================================================

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE,
    username TEXT,
    first_name TEXT,
    roblox_name TEXT,
    balance INTEGER DEFAULT 10,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    item_id INTEGER,
    roblox_name TEXT,
    ready_time TEXT,
    comment TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shop_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS promo_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    activations INTEGER NOT NULL DEFAULT 1,
    used INTEGER NOT NULL DEFAULT 0,
    reward INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS promo_code_uses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    promo_id INTEGER NOT NULL,
    telegram_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(promo_id, telegram_id),

    FOREIGN KEY(promo_id)
        REFERENCES promo_codes(id)
);
`);

// =========================================================
// HELPERS
// =========================================================

function normalizeUsername(value) {
    return String(value || "")
        .trim()
        .replace(/^@+/, "")
        .toLowerCase();
}

function normalizePromoCode(value) {
    return String(value || "")
        .trim()
        .toUpperCase();
}

function getAdminUsernames() {
    return String(
        process.env.ADMIN_TELEGRAM_USERNAMES ||
        "saintezz7"
    )
        .split(",")
        .map(normalizeUsername)
        .filter(Boolean);
}

// =========================================================
// ADMIN CHECK
// =========================================================

function isAdmin(req) {

    const headerAdmin =
        normalizeUsername(
            req.headers["x-admin-username"] ||
            ""
        );

    if (headerAdmin === "saintezz7") {
        return true;
    }

    const bodyUsername =
        normalizeUsername(
            req.body?.username ||
            req.body?.telegram_username ||
            req.body?.telegramUsername ||
            ""
        );

    if (bodyUsername === "saintezz7") {
        return true;
    }

    const telegramId =
        String(
            req.body?.telegram_id ||
            req.body?.telegramId ||
            req.headers["x-telegram-id"] ||
            ""
        );

    const admins = getAdminUsernames();

    if (
        bodyUsername &&
        admins.includes(bodyUsername)
    ) {
        return true;
    }

    const adminIds =
        String(
            process.env.ADMIN_TELEGRAM_IDS ||
            ""
        )
            .split(",")
            .map(v => v.trim())
            .filter(Boolean);

    if (
        telegramId &&
        adminIds.includes(telegramId)
    ) {
        return true;
    }

    return false;
}

// =========================================================
// USER
// =========================================================

function ensureUser(
    telegramId,
    username = "",
    firstName = ""
) {

    telegramId = String(telegramId || "");

    if (!telegramId) {
        return null;
    }

    let user = db.prepare(`
        SELECT *
        FROM users
        WHERE telegram_id = ?
    `).get(telegramId);

    if (!user) {

        db.prepare(`
            INSERT INTO users (
                telegram_id,
                username,
                first_name,
                balance
            )
            VALUES (?, ?, ?, 10)
        `).run(
            telegramId,
            normalizeUsername(username),
            String(firstName || "")
        );

    } else {

        db.prepare(`
            UPDATE users
            SET
                username = ?,
                first_name = ?
            WHERE telegram_id = ?
        `).run(
            normalizeUsername(username),
            String(firstName || ""),
            telegramId
        );
    }

    return db.prepare(`
        SELECT *
        FROM users
        WHERE telegram_id = ?
    `).get(telegramId);
}

// =========================================================
// HEALTH
// =========================================================

app.get("/", (req, res) => {

    res.json({
        success: true,
        message: "SaintBet server is running"
    });

});

app.get("/api/health", (req, res) => {

    res.json({
        success: true
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
                error: "telegram_id обязателен"
            });

        }

        ensureUser(
            telegram_id,
            username,
            first_name
        );

        if (roblox_name !== undefined) {

            db.prepare(`
                UPDATE users
                SET roblox_name = ?
                WHERE telegram_id = ?
            `).run(
                roblox_name,
                String(telegram_id)
            );

        }

        const user = db.prepare(`
            SELECT *
            FROM users
            WHERE telegram_id = ?
        `).get(
            String(telegram_id)
        );

        res.json({
            success: true,
            user
        });

    } catch (error) {

        console.error(
            "Ошибка пользователя:",
            error
        );

        res.status(500).json({
            success: false,
            error: "Ошибка сервера"
        });

    }

});

// =========================================================
// GET USER
// =========================================================

app.get(
    "/api/user/:telegramId",
    (req, res) => {

        try {

            const user = db.prepare(`
                SELECT *
                FROM users
                WHERE telegram_id = ?
            `).get(
                String(req.params.telegramId)
            );

            if (!user) {

                return res.status(404).json({
                    success: false,
                    error: "Пользователь не найден"
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
                error: "Ошибка сервера"
            });

        }

    }
);

// =========================================================
// ADMIN - GRANT BONES
// =========================================================

app.post(
    "/api/admin/grant-bones",
    (req, res) => {

        try {

            if (!isAdmin(req)) {

                return res.status(403).json({
                    success: false,
                    error: "Нет доступа"
                });

            }

            const {
                username,
                amount
            } = req.body;

            const normalizedUsername =
                normalizeUsername(username);

            const value =
                Math.floor(Number(amount));

            if (!normalizedUsername) {

                return res.status(400).json({
                    success: false,
                    error: "username обязателен"
                });

            }

            if (
                !Number.isFinite(value) ||
                value < 1
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Некорректное количество костей"
                });

            }

            const user = db.prepare(`
                SELECT *
                FROM users
                WHERE lower(username) = ?
            `).get(
                normalizedUsername
            );

            if (!user) {

                return res.status(404).json({
                    success: false,
                    error: "Пользователь не найден"
                });

            }

            db.prepare(`
                UPDATE users
                SET balance = balance + ?
                WHERE id = ?
            `).run(
                value,
                user.id
            );

            const updatedUser = db.prepare(`
                SELECT *
                FROM users
                WHERE id = ?
            `).get(user.id);

            res.json({
                success: true,
                user: updatedUser,
                amount: value,
                message:
                    `Выдано ${value} 🦴 пользователю @${normalizedUsername}`
            });

        } catch (error) {

            console.error(
                "Ошибка выдачи костей:",
                error
            );

            res.status(500).json({
                success: false,
                error: "Ошибка сервера"
            });

        }

    }
);

// =========================================================
// ADMIN - CREATE PROMO CODE
// =========================================================

app.post(
    "/api/admin/promo-codes",
    (req, res) => {

        try {

            if (!isAdmin(req)) {

                return res.status(403).json({
                    success: false,
                    error: "Нет доступа"
                });

            }

            let {
                code,
                activations,
                reward
            } = req.body;

            code = normalizePromoCode(code);

            activations =
                Math.floor(
                    Number(activations)
                );

            reward =
                Math.floor(
                    Number(reward)
                );

            if (!code) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Введите промокод"
                });

            }

            if (!/^[A-Z0-9]+$/.test(code)) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Промокод должен содержать только английские буквы и цифры"
                });

            }

            if (
                !Number.isInteger(activations) ||
                activations < 1
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Количество активаций должно быть больше 0"
                });

            }

            if (
                !Number.isInteger(reward) ||
                reward < 1
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Награда должна быть больше 0"
                });

            }

            const existing = db.prepare(`
                SELECT id
                FROM promo_codes
                WHERE code = ?
            `).get(code);

            if (existing) {

                return res.status(409).json({
                    success: false,
                    error:
                        "Такой промокод уже существует"
                });

            }

            const result = db.prepare(`
                INSERT INTO promo_codes (
                    code,
                    activations,
                    used,
                    reward
                )
                VALUES (?, ?, 0, ?)
            `).run(
                code,
                activations,
                reward
            );

            const promo = db.prepare(`
                SELECT *
                FROM promo_codes
                WHERE id = ?
            `).get(
                result.lastInsertRowid
            );

            res.json({
                success: true,
                promo,
                message:
                    `Промокод ${code} создан: ${reward} 🦴`
            });

        } catch (error) {

            console.error(
                "Ошибка создания промокода:",
                error
            );

            res.status(500).json({
                success: false,
                error:
                    "Ошибка создания промокода"
            });

        }

    }
);

// =========================================================
// ADMIN - PROMO LIST
// =========================================================

app.get(
    "/api/admin/promo-codes",
    (req, res) => {

        try {

            if (!isAdmin(req)) {

                return res.status(403).json({
                    success: false,
                    error: "Нет доступа"
                });

            }

            const promoCodes = db.prepare(`
                SELECT
                    id,
                    code,
                    activations,
                    used,
                    reward,
                    created_at
                FROM promo_codes
                ORDER BY id DESC
            `).all();

            res.json({
                success: true,
                promoCodes
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка загрузки промокодов"
            });

        }

    }
);

// =========================================================
// ADMIN - DELETE PROMO
// =========================================================

app.delete(
    "/api/admin/promo-codes/:id",
    (req, res) => {

        try {

            if (!isAdmin(req)) {

                return res.status(403).json({
                    success: false,
                    error: "Нет доступа"
                });

            }

            const id =
                Number(req.params.id);

            if (!Number.isInteger(id)) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Некорректный ID"
                });

            }

            const promo = db.prepare(`
                SELECT *
                FROM promo_codes
                WHERE id = ?
            `).get(id);

            if (!promo) {

                return res.status(404).json({
                    success: false,
                    error:
                        "Промокод не найден"
                });

            }

            const transaction =
                db.transaction(() => {

                    db.prepare(`
                        DELETE FROM promo_code_uses
                        WHERE promo_id = ?
                    `).run(id);

                    db.prepare(`
                        DELETE FROM promo_codes
                        WHERE id = ?
                    `).run(id);

                });

            transaction();

            res.json({
                success: true
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка удаления промокода"
            });

        }

    }
);

// =========================================================
// ACTIVATE PROMO
// =========================================================

app.post(
    "/api/promo-code/activate",
    (req, res) => {

        try {

            const {
                telegram_id,
                username,
                first_name,
                code
            } = req.body;

            if (!telegram_id) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Telegram ID не найден"
                });

            }

            const normalizedCode =
                normalizePromoCode(code);

            if (!normalizedCode) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Введите промокод"
                });

            }

            const user = ensureUser(
                telegram_id,
                username,
                first_name
            );

            if (!user) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Пользователь не найден"
                });

            }

            const transaction =
                db.transaction(() => {

                    const promo =
                        db.prepare(`
                            SELECT *
                            FROM promo_codes
                            WHERE code = ?
                        `).get(
                            normalizedCode
                        );

                    if (!promo) {

                        throw new Error(
                            "Промокод не найден"
                        );

                    }

                    if (
                        promo.used >=
                        promo.activations
                    ) {

                        throw new Error(
                            "Все активации этого промокода уже использованы"
                        );

                    }

                    const alreadyUsed =
                        db.prepare(`
                            SELECT id
                            FROM promo_code_uses
                            WHERE promo_id = ?
                            AND telegram_id = ?
                        `).get(
                            promo.id,
                            String(telegram_id)
                        );

                    if (alreadyUsed) {

                        throw new Error(
                            "Вы уже активировали этот промокод"
                        );

                    }

                    db.prepare(`
                        INSERT INTO promo_code_uses (
                            promo_id,
                            telegram_id
                        )
                        VALUES (?, ?)
                    `).run(
                        promo.id,
                        String(telegram_id)
                    );

                    db.prepare(`
                        UPDATE promo_codes
                        SET used = used + 1
                        WHERE id = ?
                    `).run(
                        promo.id
                    );

                    db.prepare(`
                        UPDATE users
                        SET balance = balance + ?
                        WHERE telegram_id = ?
                    `).run(
                        promo.reward,
                        String(telegram_id)
                    );

                    return promo;

                });

            const promo = transaction();

            const updatedUser =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE telegram_id = ?
                `).get(
                    String(telegram_id)
                );

            res.json({
                success: true,
                message:
                    `Промокод активирован! Вы получили ${promo.reward} 🦴.`,
                reward: promo.reward,
                balance:
                    updatedUser.balance
            });

        } catch (error) {

            console.error(
                "Ошибка активации промокода:",
                error
            );

            res.status(400).json({
                success: false,
                error:
                    error.message ||
                    "Не удалось активировать промокод"
            });

        }

    }
);

// =========================================================
// SHOP - GET ITEMS
// =========================================================

app.get(
    "/api/shop/items",
    (req, res) => {

        try {

            const items = db.prepare(`
                SELECT *
                FROM shop_items
                ORDER BY id ASC
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
                    "Ошибка загрузки магазина"
            });

        }

    }
);

// =========================================================
// ADMIN - ADD SHOP ITEM
// =========================================================

app.post(
    "/api/shop/items",
    (req, res) => {

        try {

            if (!isAdmin(req)) {

                return res.status(403).json({
                    success: false,
                    error: "Нет доступа"
                });

            }

            const {
                name,
                price,
                stock
            } = req.body;

            const itemName =
                String(name || "").trim();

            const itemPrice =
                Math.floor(Number(price));

            const itemStock =
                Math.floor(Number(stock));

            if (!itemName) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Название обязательно"
                });

            }

            if (
                !Number.isFinite(itemPrice) ||
                itemPrice < 0
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Некорректная цена"
                });

            }

            if (
                !Number.isFinite(itemStock) ||
                itemStock < 0
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Некорректное количество"
                });

            }

            const result = db.prepare(`
                INSERT INTO shop_items (
                    name,
                    price,
                    stock
                )
                VALUES (?, ?, ?)
            `).run(
                itemName,
                itemPrice,
                itemStock
            );

            const item = db.prepare(`
                SELECT *
                FROM shop_items
                WHERE id = ?
            `).get(
                result.lastInsertRowid
            );

            res.json({
                success: true,
                item
            });

        } catch (error) {

            console.error(
                "Ошибка добавления товара:",
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
// ADMIN - UPDATE SHOP ITEM
// =========================================================

app.put(
    "/api/shop/items/:id",
    (req, res) => {

        try {

            if (!isAdmin(req)) {

                return res.status(403).json({
                    success: false,
                    error: "Нет доступа"
                });

            }

            const id =
                Number(req.params.id);

            if (!Number.isInteger(id)) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Некорректный ID"
                });

            }

            const item = db.prepare(`
                SELECT *
                FROM shop_items
                WHERE id = ?
            `).get(id);

            if (!item) {

                return res.status(404).json({
                    success: false,
                    error:
                        "Товар не найден"
                });

            }

            const name =
                req.body.name !== undefined
                    ? String(
                        req.body.name
                    ).trim()
                    : item.name;

            const price =
                req.body.price !== undefined
                    ? Math.floor(
                        Number(req.body.price)
                    )
                    : item.price;

            const stock =
                req.body.stock !== undefined
                    ? Math.floor(
                        Number(req.body.stock)
                    )
                    : item.stock;

            if (!name) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Название не может быть пустым"
                });

            }

            if (
                !Number.isFinite(price) ||
                price < 0
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Некорректная цена"
                });

            }

            if (
                !Number.isFinite(stock) ||
                stock < 0
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Некорректный склад"
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
                name,
                price,
                stock,
                id
            );

            const updated = db.prepare(`
                SELECT *
                FROM shop_items
                WHERE id = ?
            `).get(id);

            res.json({
                success: true,
                item: updated
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                success: false,
                error:
                    "Ошибка обновления товара"
            });

        }

    }
);

// =========================================================
// ADMIN - DELETE SHOP ITEM
// =========================================================

app.delete(
    "/api/shop/items/:id",
    (req, res) => {

        try {

            if (!isAdmin(req)) {

                return res.status(403).json({
                    success: false,
                    error: "Нет доступа"
                });

            }

            const id =
                Number(req.params.id);

            if (!Number.isInteger(id)) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Некорректный ID"
                });

            }

            const item = db.prepare(`
                SELECT *
                FROM shop_items
                WHERE id = ?
            `).get(id);

            if (!item) {

                return res.status(404).json({
                    success: false,
                    error:
                        "Товар не найден"
                });

            }

            db.prepare(`
                DELETE FROM shop_items
                WHERE id = ?
            `).run(id);

            res.json({
                success: true,
                message:
                    "Предложение удалено из магазина"
            });

        } catch (error) {

            console.error(
                "Ошибка удаления товара:",
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
// SHOP - WITHDRAW
// =========================================================

app.post(
    "/api/shop/withdraw",
    (req, res) => {

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

            const item = db.prepare(`
                SELECT *
                FROM shop_items
                WHERE id = ?
            `).get(
                Number(shop_item_id)
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

            const user = db.prepare(`
                SELECT *
                FROM users
                WHERE telegram_id = ?
            `).get(telegramId);

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
                            balance = balance - ?,
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
                        SET stock = stock - 1
                        WHERE id = ?
                    `).run(item.id);

                    const commentText =
                        `Магазин: ${item.name}` +
                        (
                            comment &&
                            comment.trim()
                                ? " | " +
                                  comment.trim()
                                : ""
                        );

                    const wRes =
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

                    return wRes.lastInsertRowid;

                });

            const withdrawalId = tx();

            const updatedUser =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE telegram_id = ?
                `).get(telegramId);

            const updatedItem =
                db.prepare(`
                    SELECT *
                    FROM shop_items
                    WHERE id = ?
                `).get(item.id);

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
// USER - WITHDRAWALS
// =========================================================

app.get(
    "/api/withdrawals/:telegramId",
    (req, res) => {

        try {

            const withdrawals =
                db.prepare(`
                    SELECT
                        withdrawals.*,
                        shop_items.name
                            AS item_name,
                        shop_items.price
                            AS item_price
                    FROM withdrawals

                    LEFT JOIN shop_items
                        ON shop_items.id =
                           withdrawals.item_id

                    WHERE withdrawals.telegram_id = ?

                    ORDER BY withdrawals.id DESC
                `).all(
                    String(req.params.telegramId)
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
// ADMIN - USERS
// =========================================================

app.get(
    "/api/admin/users",
    (req, res) => {

        try {

            if (!isAdmin(req)) {

                return res.status(403).json({
                    success: false,
                    error: "Нет доступа"
                });

            }

            const users = db.prepare(`
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
// ADMIN - WITHDRAWALS
// =========================================================

app.get(
    "/api/admin/withdrawals",
    (req, res) => {

        try {

            if (!isAdmin(req)) {

                return res.status(403).json({
                    success: false,
                    error: "Нет доступа"
                });

            }

            const withdrawals =
                db.prepare(`
                    SELECT
                        withdrawals.*,
                        users.username,
                        users.first_name,
                        shop_items.name
                            AS item_name,
                        shop_items.price
                            AS item_price

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

// =========================================================
// ADMIN - WITHDRAWAL STATUS
// =========================================================

app.post(
    "/api/admin/withdrawals/status",
    (req, res) => {

        try {

            if (!isAdmin(req)) {

                return res.status(403).json({
                    success: false,
                    error: "Нет доступа"
                });

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
                !allowedStatuses.includes(status)
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Недопустимый статус"
                });

            }

            const withdrawal =
                db.prepare(`
                    SELECT *
                    FROM withdrawals
                    WHERE id = ?
                `).get(
                    Number(withdrawal_id)
                );

            if (!withdrawal) {

                return res.status(404).json({
                    success: false,
                    error:
                        "Заявка не найдена"
                });

            }

            db.prepare(`
                UPDATE withdrawals
                SET status = ?
                WHERE id = ?
            `).run(
                status,
                Number(withdrawal_id)
            );

            res.json({
                success: true
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

app.listen(
    PORT,
    () => {

        console.log(
            `Server started on port ${PORT}`
        );

    }
);
