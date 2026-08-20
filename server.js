 const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// =========================================================
// DATABASE
// =========================================================

const db = new Database("database.db");

db.pragma("journal_mode = WAL");

// Игроки
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT UNIQUE NOT NULL,
        username TEXT,
        first_name TEXT,
        roblox_name TEXT,
        balance INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Инвентарь
db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        inventory_type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Выводы
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

// Магазин вывода (Brainrot предложения)
db.exec(`
    CREATE TABLE IF NOT EXISTS shop_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        stock INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Инициализация стандартных предложений, если таблица пуста
try {
    const shopCount = db.prepare("SELECT COUNT(*) as count FROM shop_items").get();
    if (shopCount && shopCount.count === 0) {
        const insertShopItem = db.prepare("INSERT INTO shop_items (name, price, stock) VALUES (?, ?, ?)");
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
            insertShopItem.run(item.name, item.price, item.stock);
        }
    }
} catch (e) {
    console.error("Ошибка инициализации shop_items:", e);
}

// =========================================================
// TELEGRAM INIT DATA
// =========================================================

function validateTelegramInitData(initData) {
    const botToken = process.env.BOT_TOKEN;

    // Пока токен не указан, разрешаем запросы.
    // После подключения Mini App обязательно добавим
    // проверку Telegram initData через BOT_TOKEN.
    if (!botToken) {
        console.warn("BOT_TOKEN не установлен.");
        return true;
    }

    if (!initData) {
        return false;
    }

    try {
        const params = new URLSearchParams(initData);

        const receivedHash = params.get("hash");

        if (!receivedHash) {
            return false;
        }

        params.delete("hash");

        const dataCheckString = [...params.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join("\n");

        const secretKey = crypto
            .createHmac("sha256", "WebAppData")
            .update(botToken)
            .digest();

        const calculatedHash = crypto
            .createHmac("sha256", secretKey)
            .update(dataCheckString)
            .digest("hex");

        return calculatedHash === receivedHash;

    } catch (error) {
        console.error("Ошибка проверки Telegram:", error);
        return false;
    }
}

// =========================================================
// TELEGRAM USER
// =========================================================

function getTelegramUser(initData) {
    try {
        const params = new URLSearchParams(initData);

        const userString = params.get("user");

        if (!userString) {
            return null;
        }

        return JSON.parse(userString);

    } catch (error) {
        console.error("Ошибка получения Telegram пользователя:", error);
        return null;
    }
}

// =========================================================
// MAIN
// =========================================================

app.get("/", (req, res) => {
    res.json({
        status: "ok",
        message: "Telegram Mini App API работает!",
        database: "ok"
    });
});

// =========================================================
// REGISTER / UPDATE USER
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

        const telegramId = String(telegram_id);

        const existingUser = db.prepare(`
            SELECT *
            FROM users
            WHERE telegram_id = ?
        `).get(telegramId);

        if (existingUser) {

            db.prepare(`
                UPDATE users
                SET
                    username = ?,
                    first_name = ?,
                    roblox_name = COALESCE(?, roblox_name)
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

        const user = db.prepare(`
            SELECT *
            FROM users
            WHERE telegram_id = ?
        `).get(telegramId);

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
});

// =========================================================
// GET USER
// =========================================================

app.get("/api/user/:telegram_id", (req, res) => {

    try {

        const telegramId = String(req.params.telegram_id);

        const user = db.prepare(`
            SELECT *
            FROM users
            WHERE telegram_id = ?
        `).get(telegramId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: "Игрок не найден"
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
});

// =========================================================
// UPDATE ROBLOX NAME
// =========================================================

app.post("/api/user/roblox", (req, res) => {

    try {

        const {
            telegram_id,
            roblox_name
        } = req.body;

        if (!telegram_id) {
            return res.status(400).json({
                success: false,
                error: "telegram_id обязателен"
            });
        }

        if (!roblox_name || !roblox_name.trim()) {
            return res.status(400).json({
                success: false,
                error: "Укажите Roblox ник"
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
            message: "Roblox ник сохранён"
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: "Ошибка сервера"
        });
    }
});

// =========================================================
// ADD ITEM TO INVENTORY
// =========================================================

app.post("/api/inventory/add", (req, res) => {

    try {

        const {
            telegram_id,
            item_id,
            inventory_type
        } = req.body;

        if (!telegram_id) {
            return res.status(400).json({
                success: false,
                error: "telegram_id обязателен"
            });
        }

        if (item_id === undefined || item_id === null) {
            return res.status(400).json({
                success: false,
                error: "item_id обязателен"
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
            message: "Предмет добавлен"
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: "Ошибка сервера"
        });
    }
});

// =========================================================
// GET INVENTORY
// =========================================================

app.get("/api/inventory/:telegram_id", (req, res) => {

    try {

        const telegramId = String(req.params.telegram_id);

        const inventory = db.prepare(`
            SELECT *
            FROM inventory
            WHERE telegram_id = ?
            ORDER BY id ASC
        `).all(telegramId);

        res.json({
            success: true,
            inventory
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: "Ошибка сервера"
        });
    }
});

// =========================================================
// MOVE ITEM TO NORMAL INVENTORY
// =========================================================

app.post("/api/inventory/move", (req, res) => {

    try {

        const {
            telegram_id,
            inventory_id
        } = req.body;

        if (!telegram_id || !inventory_id) {
            return res.status(400).json({
                success: false,
                error: "Не хватает данных"
            });
        }

        const item = db.prepare(`
            SELECT *
            FROM inventory
            WHERE id = ?
              AND telegram_id = ?
              AND inventory_type = 'upgrader'
        `).get(
            Number(inventory_id),
            String(telegram_id)
        );

        if (!item) {
            return res.status(404).json({
                success: false,
                error: "Предмет не найден"
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
            message: "Предмет выведен в обычный инвентарь"
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: "Ошибка сервера"
        });
    }
});

// =========================================================
// SELL ITEM
// =========================================================

app.post("/api/inventory/sell", (req, res) => {

    try {

        const {
            telegram_id,
            inventory_id,
            price
        } = req.body;

        if (!telegram_id || !inventory_id) {
            return res.status(400).json({
                success: false,
                error: "Не хватает данных"
            });
        }

        const item = db.prepare(`
            SELECT *
            FROM inventory
            WHERE id = ?
              AND telegram_id = ?
              AND inventory_type = 'upgrader'
        `).get(
            Number(inventory_id),
            String(telegram_id)
        );

        if (!item) {
            return res.status(404).json({
                success: false,
                error: "Предмет не найден"
            });
        }

        const sellPrice = Number(price) || 0;

        const transaction = db.transaction(() => {

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
                SET balance = balance + ?
                WHERE telegram_id = ?
            `).run(
                sellPrice,
                String(telegram_id)
            );
        });

        transaction();

        res.json({
            success: true,
            message: "Предмет продан",
            received: sellPrice
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: "Ошибка сервера"
        });
    }
});

// =========================================================
// CREATE WITHDRAWAL
// =========================================================

app.post("/api/withdrawals", (req, res) => {

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
                error: "telegram_id обязателен"
            });
        }

        if (!item_id && !inventory_id) {
            return res.status(400).json({
                success: false,
                error: "Не указан предмет"
            });
        }

        if (!roblox_name || !roblox_name.trim()) {
            return res.status(400).json({
                success: false,
                error: "Укажите Roblox ник"
            });
        }

        if (!ready_time || !ready_time.trim()) {
            return res.status(400).json({
                success: false,
                error: "Укажите время"
            });
        }

        const telegramId = String(telegram_id);

        let finalItemId = item_id;

        // Если передан конкретный предмет из БД,
        // проверяем, что он принадлежит игроку.
        if (inventory_id) {

            const inventoryItem = db.prepare(`
                SELECT *
                FROM inventory
                WHERE id = ?
                  AND telegram_id = ?
                  AND inventory_type = 'upgrader'
            `).get(
                Number(inventory_id),
                telegramId
            );

            if (!inventoryItem) {
                return res.status(404).json({
                    success: false,
                    error: "Предмет не найден в инвентаре апгрейдера"
                });
            }

            finalItemId = inventoryItem.item_id;

            // Перемещаем предмет в обычный инвентарь
            // после создания заявки.
            db.prepare(`
                UPDATE inventory
                SET inventory_type = 'normal'
                WHERE id = ?
                  AND telegram_id = ?
            `).run(
                Number(inventory_id),
                telegramId
            );
        }

        const result = db.prepare(`
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

        res.json({
            success: true,
            withdrawal_id: result.lastInsertRowid,
            message: "Заявка на вывод создана"
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: "Ошибка сервера"
        });
    }
});

// =========================================================
// GET PLAYER WITHDRAWALS
// =========================================================

app.get("/api/withdrawals/:telegram_id", (req, res) => {

    try {

        const telegramId = String(req.params.telegram_id);

        const withdrawals = db.prepare(`
            SELECT *
            FROM withdrawals
            WHERE telegram_id = ?
            ORDER BY id DESC
        `).all(telegramId);

        res.json({
            success: true,
            withdrawals
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: "Ошибка сервера"
        });
    }
});

// =========================================================
// ADMIN - ALL PLAYERS
// =========================================================

app.get("/api/admin/users", (req, res) => {

    try {

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
            error: "Ошибка сервера"
        });
    }
});

// =========================================================
// ADMIN - ALL WITHDRAWALS
// =========================================================

app.get("/api/admin/withdrawals", (req, res) => {

    try {

        const withdrawals = db.prepare(`
            SELECT
                withdrawals.*,
                users.username,
                users.first_name
            FROM withdrawals
            LEFT JOIN users
                ON users.telegram_id = withdrawals.telegram_id
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
            error: "Ошибка сервера"
        });
    }
});

// =========================================================
// ADMIN - CHANGE WITHDRAWAL STATUS
// =========================================================

app.post("/api/admin/withdrawals/status", (req, res) => {

    try {

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
                error: "withdrawal_id обязателен"
            });
        }

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                error: "Недопустимый статус"
            });
        }

        const result = db.prepare(`
            UPDATE withdrawals
            SET status = ?
            WHERE id = ?
        `).run(
            status,
            Number(withdrawal_id)
        );

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                error: "Заявка не найдена"
            });
        }

        res.json({
            success: true,
            message: "Статус изменён"
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: "Ошибка сервера"
        });
    }
});

// =========================================================
// SHOP (WITHDRAWAL OFFERS) API
// =========================================================

// Получить все товары для вывода
app.get("/api/shop/items", (req, res) => {
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
        console.error("Ошибка получения товаров:", error);
        res.status(500).json({
            success: false,
            error: "Ошибка сервера"
        });
    }
});

// Добавить новый товар (Admin)
app.post("/api/shop/items", (req, res) => {
    try {
        const { name, price, stock } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                error: "Укажите название браинрота"
            });
        }

        const itemPrice = Number(price);
        const itemStock = Number(stock !== undefined ? stock : 1);

        if (isNaN(itemPrice) || itemPrice < 0) {
            return res.status(400).json({
                success: false,
                error: "Укажите корректную цену"
            });
        }

        const result = db.prepare(`
            INSERT INTO shop_items (name, price, stock)
            VALUES (?, ?, ?)
        `).run(name.trim(), itemPrice, isNaN(itemStock) || itemStock < 0 ? 0 : itemStock);

        const newItem = db.prepare(`
            SELECT * FROM shop_items WHERE id = ?
        `).get(result.lastInsertRowid);

        res.json({
            success: true,
            item: newItem,
            message: "Браинрот добавлен в магазин"
        });
    } catch (error) {
        console.error("Ошибка добавления товара:", error);
        res.status(500).json({
            success: false,
            error: "Ошибка сервера"
        });
    }
});

// Обновить товар (Admin - цена / количество / название)
app.put("/api/shop/items/:id", (req, res) => {
    try {
        const itemId = Number(req.params.id);
        const { name, price, stock } = req.body;

        const existing = db.prepare(`SELECT * FROM shop_items WHERE id = ?`).get(itemId);
        if (!existing) {
            return res.status(404).json({
                success: false,
                error: "Товар не найден"
            });
        }

        const newName = name !== undefined ? name.trim() : existing.name;
        const newPrice = price !== undefined ? Number(price) : existing.price;
        const newStock = stock !== undefined ? Number(stock) : existing.stock;

        db.prepare(`
            UPDATE shop_items
            SET name = ?, price = ?, stock = ?
            WHERE id = ?
        `).run(newName, newPrice, Math.max(0, newStock), itemId);

        const updatedItem = db.prepare(`SELECT * FROM shop_items WHERE id = ?`).get(itemId);

        res.json({
            success: true,
            item: updatedItem,
            message: "Товар обновлён"
        });
    } catch (error) {
        console.error("Ошибка обновления товара:", error);
        res.status(500).json({
            success: false,
            error: "Ошибка сервера"
        });
    }
});

// Удалить товар (Admin)
app.delete("/api/shop/items/:id", (req, res) => {
    try {
        const itemId = Number(req.params.id);

        const result = db.prepare(`DELETE FROM shop_items WHERE id = ?`).run(itemId);

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                error: "Товар не найден"
            });
        }

        res.json({
            success: true,
            message: "Предложение удалено из магазина"
        });
    } catch (error) {
        console.error("Ошибка удаления товара:", error);
        res.status(500).json({
            success: false,
            error: "Ошибка сервера"
        });
    }
});

// Оформить вывод браинрота из магазина
app.post("/api/shop/withdraw", (req, res) => {
    try {
        const {
            telegram_id,
            shop_item_id,
            roblox_name,
            ready_time,
            comment
        } = req.body;

        if (!telegram_id || !shop_item_id) {
            return res.status(400).json({
                success: false,
                error: "telegram_id и shop_item_id обязательны"
            });
        }

        if (!roblox_name || !roblox_name.trim()) {
            return res.status(400).json({
                success: false,
                error: "Укажите Roblox ник"
            });
        }

        if (!ready_time || !ready_time.trim()) {
            return res.status(400).json({
                success: false,
                error: "Укажите время получения"
            });
        }

        const telegramId = String(telegram_id);
        const item = db.prepare("SELECT * FROM shop_items WHERE id = ?").get(Number(shop_item_id));

        if (!item) {
            return res.status(404).json({
                success: false,
                error: "Товар не найден в магазине"
            });
        }

        if (item.stock < 1) {
            return res.status(400).json({
                success: false,
                error: "Этого браинрота нет в наличии на складе"
            });
        }

        const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId);
        if (!user || user.balance < item.price) {
            return res.status(400).json({
                success: false,
                error: "Недостаточно костей для вывода"
            });
        }

        const tx = db.transaction(() => {
            // Списываем кости
            db.prepare(`
                UPDATE users
                SET balance = balance - ?,
                    roblox_name = COALESCE(?, roblox_name)
                WHERE telegram_id = ?
            `).run(item.price, roblox_name.trim(), telegramId);

            // Уменьшаем остаток на складе
            db.prepare(`
                UPDATE shop_items
                SET stock = stock - 1
                WHERE id = ?
            `).run(item.id);

            // Создаём запись в заявках на вывод
            const commentText = `Магазин: ${item.name}${comment && comment.trim() ? ' | ' + comment.trim() : ''}`;
            const wRes = db.prepare(`
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
        const updatedUser = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId);
        const updatedItem = db.prepare("SELECT * FROM shop_items WHERE id = ?").get(item.id);

        res.json({
            success: true,
            withdrawal_id: withdrawalId,
            user: updatedUser,
            item: updatedItem,
            message: `Заявка на вывод ${item.name} успешно создана!`
        });

    } catch (error) {
        console.error("Ошибка вывода товара:", error);
        res.status(500).json({
            success: false,
            error: "Ошибка сервера"
        });
    }
});

// =========================================================
// ERROR HANDLER
// =========================================================

app.use((error, req, res, next) => {

    console.error(error);

    res.status(500).json({
        success: false,
        error: "Внутренняя ошибка сервера"
    });
});

// =========================================================
// START
// =========================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
