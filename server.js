const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname, { index: false }));

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

// Магазин вывода
db.exec(`
    CREATE TABLE IF NOT EXISTS shop_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        stock INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Инициализация магазина
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

// Промокоды
db.exec(`
    CREATE TABLE IF NOT EXISTS promo_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        max_activations INTEGER NOT NULL DEFAULT 1,
        activations INTEGER NOT NULL DEFAULT 1,
        used_count INTEGER NOT NULL DEFAULT 0,
        used INTEGER NOT NULL DEFAULT 0,
        reward INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

try { db.exec("ALTER TABLE promo_codes ADD COLUMN max_activations INTEGER DEFAULT 1"); } catch(e) {}
try { db.exec("ALTER TABLE promo_codes ADD COLUMN activations INTEGER DEFAULT 1"); } catch(e) {}
try { db.exec("ALTER TABLE promo_codes ADD COLUMN used_count INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE promo_codes ADD COLUMN used INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE promo_codes ADD COLUMN expires_at INTEGER DEFAULT 0"); } catch(e) {}

// Активации промокодов
db.exec(`
    CREATE TABLE IF NOT EXISTS promo_activations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        telegram_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(code, telegram_id)
    )
`);

// ✅ ВКЛАД ОТ ПРОМОКОДОВ (для розыгрышей)
db.exec(`
    CREATE TABLE IF NOT EXISTS promo_contributions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        code TEXT NOT NULL,
        amount INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// ✅ РОЗЫГРЫШИ
db.exec(`
    CREATE TABLE IF NOT EXISTS giveaways (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        image_url TEXT,
        prize_amount INTEGER NOT NULL DEFAULT 0,
        max_participants INTEGER NOT NULL DEFAULT 0,
        min_contribution INTEGER NOT NULL DEFAULT 50,
        winners_count INTEGER NOT NULL DEFAULT 1,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// ✅ УЧАСТНИКИ РОЗЫГРЫШЕЙ
db.exec(`
    CREATE TABLE IF NOT EXISTS giveaway_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        giveaway_id INTEGER NOT NULL,
        telegram_id TEXT NOT NULL,
        username TEXT,
        first_name TEXT,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_winner INTEGER DEFAULT 0,
        UNIQUE(giveaway_id, telegram_id)
    )
`);

// =========================================================
// TELEGRAM VALIDATION
// =========================================================

function validateTelegramInitData(initData) {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) return true;
    if (!initData) return false;
    try {
        const params = new URLSearchParams(initData);
        const receivedHash = params.get("hash");
        if (!receivedHash) return false;
        params.delete("hash");
        const dataCheckString = [...params.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join("\n");
        const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
        const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
        return calculatedHash === receivedHash;
    } catch (error) {
        console.error("Ошибка проверки Telegram:", error);
        return false;
    }
}

function getTelegramUser(initData) {
    try {
        const params = new URLSearchParams(initData);
        const userString = params.get("user");
        if (!userString) return null;
        return JSON.parse(userString);
    } catch (error) {
        console.error("Ошибка получения Telegram пользователя:", error);
        return null;
    }
}

// =========================================================
// MAIN & STATIC
// =========================================================

app.get(["/", "/index.html"], (req, res) => {
    const indexPath = path.join(__dirname, "index.html");
    if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
    }
    res.json({ status: "ok", message: "Telegram Mini App API работает!", database: "ok" });
});

// =========================================================
// USERS
// =========================================================

app.post("/api/user", (req, res) => {
    try {
        const { telegram_id, username, first_name, roblox_name } = req.body;
        if (!telegram_id) return res.status(400).json({ success: false, error: "telegram_id обязателен" });
        const telegramId = String(telegram_id);
        const existingUser = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);

        if (existingUser) {
            db.prepare(`UPDATE users SET username = ?, first_name = ?, roblox_name = COALESCE(?, roblox_name) WHERE telegram_id = ?`)
              .run(username || null, first_name || null, roblox_name || null, telegramId);
        } else {
            db.prepare(`INSERT INTO users (telegram_id, username, first_name, roblox_name, balance) VALUES (?, ?, ?, ?, 0)`)
              .run(telegramId, username || null, first_name || null, roblox_name || null);
        }
        const user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
        res.json({ success: true, user });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.get("/api/user/:telegram_id", (req, res) => {
    try {
        const telegramId = String(req.params.telegram_id);
        const user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
        if (!user) return res.status(404).json({ success: false, error: "Игрок не найден" });
        res.json({ success: true, user });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.post("/api/user/roblox", (req, res) => {
    try {
        const { telegram_id, roblox_name } = req.body;
        if (!telegram_id) return res.status(400).json({ success: false, error: "telegram_id обязателен" });
        if (!roblox_name || !roblox_name.trim()) return res.status(400).json({ success: false, error: "Укажите Roblox ник" });
        db.prepare(`UPDATE users SET roblox_name = ? WHERE telegram_id = ?`).run(roblox_name.trim(), String(telegram_id));
        res.json({ success: true, message: "Roblox ник сохранён" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// =========================================================
// INVENTORY
// =========================================================

app.post("/api/inventory/add", (req, res) => {
    try {
        const { telegram_id, item_id, inventory_type } = req.body;
        if (!telegram_id) return res.status(400).json({ success: false, error: "telegram_id обязателен" });
        if (item_id === undefined || item_id === null) return res.status(400).json({ success: false, error: "item_id обязателен" });
        const type = inventory_type === "normal" ? "normal" : "upgrader";
        db.prepare(`INSERT INTO inventory (telegram_id, item_id, inventory_type) VALUES (?, ?, ?)`)
          .run(String(telegram_id), Number(item_id), type);
        res.json({ success: true, message: "Предмет добавлен" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.get("/api/inventory/:telegram_id", (req, res) => {
    try {
        const telegramId = String(req.params.telegram_id);
        const inventory = db.prepare(`SELECT * FROM inventory WHERE telegram_id = ? ORDER BY id ASC`).all(telegramId);
        res.json({ success: true, inventory });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.post("/api/inventory/move", (req, res) => {
    try {
        const { telegram_id, inventory_id } = req.body;
        if (!telegram_id || !inventory_id) return res.status(400).json({ success: false, error: "Не хватает данных" });
        const item = db.prepare(`SELECT * FROM inventory WHERE id = ? AND telegram_id = ? AND inventory_type = 'upgrader'`)
          .get(Number(inventory_id), String(telegram_id));
        if (!item) return res.status(404).json({ success: false, error: "Предмет не найден" });
        db.prepare(`UPDATE inventory SET inventory_type = 'normal' WHERE id = ? AND telegram_id = ?`)
          .run(Number(inventory_id), String(telegram_id));
        res.json({ success: true, message: "Предмет выведен в обычный инвентарь" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.post("/api/inventory/sell", (req, res) => {
    try {
        const { telegram_id, inventory_id, price } = req.body;
        if (!telegram_id || !inventory_id) return res.status(400).json({ success: false, error: "Не хватает данных" });
        const item = db.prepare(`SELECT * FROM inventory WHERE id = ? AND telegram_id = ? AND inventory_type = 'upgrader'`)
          .get(Number(inventory_id), String(telegram_id));
        if (!item) return res.status(404).json({ success: false, error: "Предмет не найден" });
        const sellPrice = Number(price) || 0;
        const transaction = db.transaction(() => {
            db.prepare(`DELETE FROM inventory WHERE id = ? AND telegram_id = ?`).run(Number(inventory_id), String(telegram_id));
            db.prepare(`UPDATE users SET balance = balance + ? WHERE telegram_id = ?`).run(sellPrice, String(telegram_id));
        });
        transaction();
        res.json({ success: true, message: "Предмет продан", received: sellPrice });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// =========================================================
// WITHDRAWALS
// =========================================================

app.post("/api/withdrawals", (req, res) => {
    try {
        const { telegram_id, inventory_id, item_id, roblox_name, ready_time, comment } = req.body;
        if (!telegram_id) return res.status(400).json({ success: false, error: "telegram_id обязателен" });
        if (!item_id && !inventory_id) return res.status(400).json({ success: false, error: "Не указан предмет" });
        if (!roblox_name || !roblox_name.trim()) return res.status(400).json({ success: false, error: "Укажите Roblox ник" });
        if (!ready_time || !ready_time.trim()) return res.status(400).json({ success: false, error: "Укажите время" });
        const telegramId = String(telegram_id);
        let finalItemId = item_id;
        if (inventory_id) {
            const inventoryItem = db.prepare(`SELECT * FROM inventory WHERE id = ? AND telegram_id = ? AND inventory_type = 'upgrader'`)
              .get(Number(inventory_id), telegramId);
            if (!inventoryItem) return res.status(404).json({ success: false, error: "Предмет не найден в инвентаре апгрейдера" });
            finalItemId = inventoryItem.item_id;
            db.prepare(`UPDATE inventory SET inventory_type = 'normal' WHERE id = ? AND telegram_id = ?`).run(Number(inventory_id), telegramId);
        }
        const result = db.prepare(`INSERT INTO withdrawals (telegram_id, item_id, roblox_name, ready_time, comment) VALUES (?, ?, ?, ?, ?)`)
          .run(telegramId, Number(finalItemId), roblox_name.trim(), ready_time.trim(), comment ? comment.trim() : null);
        res.json({ success: true, withdrawal_id: result.lastInsertRowid, message: "Заявка на вывод создана" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.get("/api/withdrawals/:telegram_id", (req, res) => {
    try {
        const telegramId = String(req.params.telegram_id);
        const withdrawals = db.prepare(`SELECT * FROM withdrawals WHERE telegram_id = ? ORDER BY id DESC`).all(telegramId);
        res.json({ success: true, withdrawals });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// =========================================================
// ADMIN
// =========================================================

app.get("/api/admin/users", (req, res) => {
    try {
        const users = db.prepare(`SELECT * FROM users ORDER BY id DESC`).all();
        res.json({ success: true, users });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.get("/api/admin/withdrawals", (req, res) => {
    try {
        const withdrawals = db.prepare(`
            SELECT withdrawals.*, users.username, users.first_name
            FROM withdrawals
            LEFT JOIN users ON users.telegram_id = withdrawals.telegram_id
            ORDER BY withdrawals.id DESC
        `).all();
        res.json({ success: true, withdrawals });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.post("/api/admin/withdrawals/status", (req, res) => {
    try {
        const { withdrawal_id, status } = req.body;
        const allowedStatuses = ["pending", "processing", "completed", "rejected"];
        if (!withdrawal_id) return res.status(400).json({ success: false, error: "withdrawal_id обязателен" });
        if (!allowedStatuses.includes(status)) return res.status(400).json({ success: false, error: "Недопустимый статус" });
        const result = db.prepare(`UPDATE withdrawals SET status = ? WHERE id = ?`).run(status, Number(withdrawal_id));
        if (result.changes === 0) return res.status(404).json({ success: false, error: "Заявка не найдена" });
        res.json({ success: true, message: "Статус изменён" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.post("/api/admin/grant-bones", (req, res) => {
    try {
        const { target_username, username, amount } = req.body;
        if (!target_username || !amount) return res.status(400).json({ success: false, error: "target_username и amount обязательны" });
        const amt = Number(amount);
        if (isNaN(amt) || amt <= 0) return res.status(400).json({ success: false, error: "amount должен быть больше 0" });
        const user = db.prepare(`SELECT * FROM users WHERE username = ?`).get(String(target_username).replace(/^@/, ""));
        if (!user) return res.status(404).json({ success: false, error: `Пользователь @${target_username} не найден` });
        db.prepare(`UPDATE users SET balance = balance + ? WHERE telegram_id = ?`).run(amt, user.telegram_id);
        const updated = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(user.telegram_id);
        res.json({ success: true, message: `Выдано ${amt} костей пользователю @${target_username}`, user: updated });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// =========================================================
// SHOP
// =========================================================

app.get("/api/shop/items", (req, res) => {
    try {
        const items = db.prepare(`SELECT * FROM shop_items ORDER BY id ASC`).all();
        res.json({ success: true, items });
    } catch (error) {
        console.error("Ошибка получения товаров:", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.post("/api/shop/items", (req, res) => {
    try {
        const { name, price, stock } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ success: false, error: "Укажите название браинрота" });
        const itemPrice = Number(price);
        const itemStock = Number(stock !== undefined ? stock : 1);
        if (isNaN(itemPrice) || itemPrice < 0) return res.status(400).json({ success: false, error: "Укажите корректную цену" });
        const result = db.prepare(`INSERT INTO shop_items (name, price, stock) VALUES (?, ?, ?)`)
          .run(name.trim(), itemPrice, isNaN(itemStock) || itemStock < 0 ? 0 : itemStock);
        const newItem = db.prepare(`SELECT * FROM shop_items WHERE id = ?`).get(result.lastInsertRowid);
        res.json({ success: true, item: newItem, message: "Браинрот добавлен в магазин" });
    } catch (error) {
        console.error("Ошибка добавления товара:", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.put("/api/shop/items/:id", (req, res) => {
    try {
        const itemId = Number(req.params.id);
        const { name, price, stock } = req.body;
        const existing = db.prepare(`SELECT * FROM shop_items WHERE id = ?`).get(itemId);
        if (!existing) return res.status(404).json({ success: false, error: "Товар не найден" });
        const newName = name !== undefined ? name.trim() : existing.name;
        const newPrice = price !== undefined ? Number(price) : existing.price;
        const newStock = stock !== undefined ? Number(stock) : existing.stock;
        db.prepare(`UPDATE shop_items SET name = ?, price = ?, stock = ? WHERE id = ?`)
          .run(newName, newPrice, Math.max(0, newStock), itemId);
        const updatedItem = db.prepare(`SELECT * FROM shop_items WHERE id = ?`).get(itemId);
        res.json({ success: true, item: updatedItem, message: "Товар обновлён" });
    } catch (error) {
        console.error("Ошибка обновления товара:", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.delete("/api/shop/items/:id", (req, res) => {
    try {
        const itemId = Number(req.params.id);
        const result = db.prepare(`DELETE FROM shop_items WHERE id = ?`).run(itemId);
        if (result.changes === 0) return res.status(404).json({ success: false, error: "Товар не найден" });
        res.json({ success: true, message: "Предложение удалено из магазина" });
    } catch (error) {
        console.error("Ошибка удаления товара:", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.post("/api/shop/withdraw", (req, res) => {
    try {
        const { telegram_id, shop_item_id, roblox_name, ready_time, comment } = req.body;
        if (!telegram_id || !shop_item_id) return res.status(400).json({ success: false, error: "telegram_id и shop_item_id обязательны" });
        if (!roblox_name || !roblox_name.trim()) return res.status(400).json({ success: false, error: "Укажите Roblox ник" });
        if (!ready_time || !ready_time.trim()) return res.status(400).json({ success: false, error: "Укажите время получения" });
        const telegramId = String(telegram_id);
        const item = db.prepare("SELECT * FROM shop_items WHERE id = ?").get(Number(shop_item_id));
        if (!item) return res.status(404).json({ success: false, error: "Товар не найден в магазине" });
        if (item.stock < 1) return res.status(400).json({ success: false, error: "Этого браинрота нет в наличии на складе" });
        const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId);
        if (!user || user.balance < item.price) return res.status(400).json({ success: false, error: "Недостаточно костей для вывода" });
        const tx = db.transaction(() => {
            db.prepare(`UPDATE users SET balance = balance - ?, roblox_name = COALESCE(?, roblox_name) WHERE telegram_id = ?`)
              .run(item.price, roblox_name.trim(), telegramId);
            db.prepare(`UPDATE shop_items SET stock = stock - 1 WHERE id = ?`).run(item.id);
            const commentText = `Магазин: ${item.name}${comment && comment.trim() ? ' | ' + comment.trim() : ''}`;
            const wRes = db.prepare(`INSERT INTO withdrawals (telegram_id, item_id, roblox_name, ready_time, comment) VALUES (?, ?, ?, ?, ?)`)
              .run(telegramId, item.id, roblox_name.trim(), ready_time.trim(), commentText);
            return wRes.lastInsertRowid;
        });
        const withdrawalId = tx();
        const updatedUser = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId);
        const updatedItem = db.prepare("SELECT * FROM shop_items WHERE id = ?").get(item.id);
        res.json({ success: true, withdrawal_id: withdrawalId, user: updatedUser, item: updatedItem, message: `Заявка на вывод ${item.name} успешно создана!` });
    } catch (error) {
        console.error("Ошибка вывода товара:", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// =========================================================
// PROMO CODES
// =========================================================

app.post(["/api/promo/redeem", "/api/promo-code/activate"], (req, res) => {
    try {
        const { code } = req.body;
        if (!code || !String(code).trim()) return res.status(400).json({ success: false, error: "Укажите промокод" });
        const codeUpper = String(code).trim().toUpperCase();

        let telegramId = null;
        let username = null;
        let firstName = null;

        const initData = req.headers["x-telegram-init-data"];
        if (initData) {
            const tgUser = getTelegramUser(initData);
            if (tgUser && tgUser.id) {
                telegramId = String(tgUser.id);
                username = tgUser.username ? String(tgUser.username).toLowerCase() : null;
                firstName = tgUser.first_name ? String(tgUser.first_name) : null;
            }
        }

        if (!telegramId) {
            telegramId = req.body.telegram_id 
                ? String(req.body.telegram_id).trim()
                : (req.body.user_id 
                    ? String(req.body.user_id).trim() 
                    : (req.body.username ? String(req.body.username).trim() : null));
        }
        if (!telegramId) telegramId = req.headers["x-user-id"] || "user_" + (req.ip || "local").replace(/[^a-zA-Z0-9]/g, "");
        if (req.body.username && !username) username = String(req.body.username).trim().toLowerCase();
        if (req.body.first_name && !firstName) firstName = String(req.body.first_name).trim();

        const promo = db.prepare(`
            SELECT id, code,
                COALESCE(max_activations, activations, 1) AS max_activations,
                COALESCE(used_count, used, 0) AS used_count,
                reward,
                COALESCE(expires_at, 0) AS expires_at
            FROM promo_codes WHERE code = ?
        `).get(codeUpper);

        if (!promo) return res.status(404).json({ success: false, error: "Промокод не найден" });
        if (promo.expires_at > 0 && Date.now() > promo.expires_at) return res.status(410).json({ success: false, error: "Срок действия промокода истёк" });
        if (promo.used_count >= promo.max_activations) return res.status(409).json({ success: false, error: "Лимит активаций промокода исчерпан" });

        const alreadyUsed = db.prepare(`SELECT id FROM promo_activations WHERE code = ? AND telegram_id = ?`).get(codeUpper, telegramId);
        if (alreadyUsed) return res.status(409).json({ success: false, error: "Ты уже активировал этот промокод" });

        let user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
        if (!user) {
            db.prepare(`INSERT INTO users (telegram_id, username, first_name, balance) VALUES (?, ?, ?, 0)`)
              .run(telegramId, username || null, firstName || null);
            user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
        }

        const balanceBefore = Number(user.balance) || 0;

        const tx = db.transaction(() => {
            db.prepare(`UPDATE promo_codes SET used_count = COALESCE(used_count, 0) + 1, used = COALESCE(used, 0) + 1 WHERE id = ?`).run(promo.id);
            db.prepare(`INSERT INTO promo_activations (code, telegram_id) VALUES (?, ?)`).run(codeUpper, telegramId);
            db.prepare(`UPDATE users SET balance = balance + ? WHERE telegram_id = ?`).run(promo.reward, telegramId);
            // ✅ Логируем вклад в промокоды
            try {
                db.prepare(`INSERT INTO promo_contributions (telegram_id, code, amount) VALUES (?, ?, ?)`)
                  .run(telegramId, codeUpper, promo.reward);
            } catch(e) { console.error("promo_contributions insert error:", e); }
        });

        tx();

        const updatedUser = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
        const finalBalance = updatedUser ? Number(updatedUser.balance) : (balanceBefore + promo.reward);

        console.log(`[PROMO] ${codeUpper} активирован для ${telegramId}. Баланс до: ${balanceBefore}, награда: ${promo.reward}, после: ${finalBalance}`);

        res.json({ success: true, reward: promo.reward, balance: finalBalance, message: `Промокод активирован! +${promo.reward} 🦴` });
    } catch (error) {
        console.error("Ошибка активации промокода:", error);
        res.status(500).json({ success: false, error: "Ошибка сервера при активации" });
    }
});

app.get(["/api/admin/promos", "/api/admin/promo-codes"], (req, res) => {
    try {
        const promoCodes = db.prepare(`
            SELECT id, code,
                COALESCE(max_activations, activations, 1) AS max_activations,
                COALESCE(max_activations, activations, 1) AS activations,
                COALESCE(used_count, used, 0) AS used_count,
                COALESCE(used_count, used, 0) AS used,
                reward,
                COALESCE(expires_at, 0) AS expires_at,
                created_at
            FROM promo_codes ORDER BY id DESC
        `).all();
        res.json({ success: true, promos: promoCodes, promoCodes: promoCodes });
    } catch (error) {
        console.error("Ошибка получения промокодов:", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.post(["/api/admin/promos", "/api/admin/promo-codes"], (req, res) => {
    try {
        const { code, max_activations, activations, expires_in_minutes, reward } = req.body;
        if (!code || !String(code).trim()) return res.status(400).json({ success: false, error: "Укажите название промокода" });
        const codeUpper = String(code).trim().toUpperCase();
        const acts = Math.floor(Number(max_activations !== undefined ? max_activations : activations));
        const rew = Math.floor(Number(reward !== undefined ? reward : 10));
        const minutes = Number(expires_in_minutes);
        if (isNaN(acts) || acts < 1) return res.status(400).json({ success: false, error: "Количество активаций должно быть больше 0" });
        if (isNaN(rew) || rew < 1) return res.status(400).json({ success: false, error: "Награда должна быть больше 0" });
        let expiresAt = 0;
        if (!isNaN(minutes) && minutes > 0) expiresAt = Date.now() + Math.floor(minutes * 60 * 1000);
        const existing = db.prepare(`SELECT id FROM promo_codes WHERE code = ?`).get(codeUpper);
        if (existing) return res.status(400).json({ success: false, error: "Такой промокод уже существует" });
        const result = db.prepare(`INSERT INTO promo_codes (code, max_activations, activations, used_count, used, reward, expires_at) VALUES (?, ?, ?, 0, 0, ?, ?)`)
          .run(codeUpper, acts, acts, rew, expiresAt);
        const newPromo = db.prepare(`
            SELECT id, code,
                COALESCE(max_activations, activations, 1) AS max_activations,
                COALESCE(used_count, used, 0) AS used_count,
                reward, COALESCE(expires_at, 0) AS expires_at, created_at
            FROM promo_codes WHERE id = ?
        `).get(result.lastInsertRowid);
        res.json({ success: true, promo: newPromo, promoCode: newPromo, message: `Промокод ${codeUpper} успешно создан!` });
    } catch (error) {
        console.error("Ошибка создания промокода:", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.delete(["/api/admin/promos/:id", "/api/admin/promo-codes/:id"], (req, res) => {
    try {
        const id = Number(req.params.id);
        const promo = db.prepare(`SELECT code FROM promo_codes WHERE id = ?`).get(id);
        const result = db.prepare(`DELETE FROM promo_codes WHERE id = ?`).run(id);
        if (result.changes === 0) return res.status(404).json({ success: false, error: "Промокод не найден" });
        if (promo && promo.code) {
            try { db.prepare(`DELETE FROM promo_activations WHERE code = ?`).run(promo.code); } catch(e) {}
        }
        res.json({ success: true, message: "Промокод удалён" });
    } catch (error) {
        console.error("Ошибка удаления промокода:", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// =========================================================
// ✅ GIVEAWAYS (РОЗЫГРЫШИ)
// =========================================================

// Получить вклад пользователя по промокодам
app.get("/api/promo-contributions/:telegram_id", (req, res) => {
    try {
        const telegramId = String(req.params.telegram_id);
        const row = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM promo_contributions WHERE telegram_id = ?`).get(telegramId);
        res.json({ success: true, total: Number(row?.total || 0) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// Получить все активные розыгрыши
app.get("/api/giveaways", (req, res) => {
    try {
        const rows = db.prepare(`SELECT * FROM giveaways ORDER BY id DESC`).all();
        const list = rows.map(g => {
            const pCount = db.prepare(`SELECT COUNT(*) AS cnt FROM giveaway_participants WHERE giveaway_id = ?`).get(g.id);
            return { ...g, participants_count: Number(pCount?.cnt || 0) };
        });
        res.json({ success: true, giveaways: list });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// Создать розыгрыш (admin)
app.post("/api/giveaways", (req, res) => {
    try {
        const { name, image_url, prize_amount, max_participants, min_contribution, winners_count } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ success: false, error: "Укажите имя браинрота" });
        const pAmt = Math.max(0, Math.floor(Number(prize_amount) || 0));
        const mPart = Math.max(0, Math.floor(Number(max_participants) || 0));
        const mContr = Math.max(0, Math.floor(Number(min_contribution) || 50));
        const wCount = Math.max(1, Math.floor(Number(winners_count) || 1));
        const result = db.prepare(`
            INSERT INTO giveaways (name, image_url, prize_amount, max_participants, min_contribution, winners_count, status)
            VALUES (?, ?, ?, ?, ?, ?, 'active')
        `).run(name.trim(), image_url ? String(image_url).trim() : null, pAmt, mPart, mContr, wCount);
        const newGiveaway = db.prepare(`SELECT * FROM giveaways WHERE id = ?`).get(result.lastInsertRowid);
        res.json({ success: true, giveaway: newGiveaway, message: `Розыгрыш "${name}" создан!` });
    } catch (error) {
        console.error("Ошибка создания розыгрыша:", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// Удалить розыгрыш (admin)
app.delete("/api/giveaways/:id", (req, res) => {
    try {
        const id = Number(req.params.id);
        const tx = db.transaction(() => {
            db.prepare(`DELETE FROM giveaway_participants WHERE giveaway_id = ?`).run(id);
            db.prepare(`DELETE FROM giveaways WHERE id = ?`).run(id);
        });
        tx();
        res.json({ success: true, message: "Розыгрыш удалён" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// Участвовать в розыгрыше
app.post("/api/giveaways/:id/join", (req, res) => {
    try {
        const giveawayId = Number(req.params.id);
        const { telegram_id, username, first_name } = req.body;
        if (!telegram_id) return res.status(400).json({ success: false, error: "telegram_id обязателен" });

        const giveaway = db.prepare(`SELECT * FROM giveaways WHERE id = ?`).get(giveawayId);
        if (!giveaway) return res.status(404).json({ success: false, error: "Розыгрыш не найден" });
        if (giveaway.status !== 'active') return res.status(400).json({ success: false, error: "Розыгрыш уже завершён" });

        const telegramId = String(telegram_id);

        // Проверка вклада промокодов
        const contrib = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM promo_contributions WHERE telegram_id = ?`).get(telegramId);
        const totalContribution = Number(contrib?.total || 0);
        if (totalContribution < giveaway.min_contribution) {
            return res.status(400).json({
                success: false,
                error: `Нужно внести промокодов на ${giveaway.min_contribution} 💎. У тебя: ${totalContribution} 💎`,
                required: giveaway.min_contribution,
                current: totalContribution
            });
        }

        // Проверка лимита участников
        if (giveaway.max_participants > 0) {
            const pCount = db.prepare(`SELECT COUNT(*) AS cnt FROM giveaway_participants WHERE giveaway_id = ?`).get(giveawayId);
            if (Number(pCount?.cnt || 0) >= giveaway.max_participants) {
                return res.status(400).json({ success: false, error: "Достигнут лимит участников" });
            }
        }

        // Проверка повторного участия
        const already = db.prepare(`SELECT id FROM giveaway_participants WHERE giveaway_id = ? AND telegram_id = ?`).get(giveawayId, telegramId);
        if (already) return res.status(400).json({ success: false, error: "Ты уже участвуешь" });

        db.prepare(`INSERT INTO giveaway_participants (giveaway_id, telegram_id, username, first_name) VALUES (?, ?, ?, ?)`)
          .run(giveawayId, telegramId, username || null, first_name || null);

        res.json({ success: true, message: "Ты участвуешь в розыгрыше!" });
    } catch (error) {
        console.error("Ошибка участия в розыгрыше:", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// Завершить розыгрыш и выбрать победителей (admin)
app.post("/api/giveaways/:id/finish", (req, res) => {
    try {
        const giveawayId = Number(req.params.id);
        const giveaway = db.prepare(`SELECT * FROM giveaways WHERE id = ?`).get(giveawayId);
        if (!giveaway) return res.status(404).json({ success: false, error: "Розыгрыш не найден" });

        const participants = db.prepare(`SELECT * FROM giveaway_participants WHERE giveaway_id = ?`).all(giveawayId);
        if (participants.length === 0) return res.status(400).json({ success: false, error: "Нет участников" });

        // Перемешать и выбрать N победителей
        const shuffled = [...participants].sort(() => Math.random() - 0.5);
        const winners = shuffled.slice(0, Math.min(giveaway.winners_count, participants.length));
        const winnerIds = winners.map(w => w.id);

        const tx = db.transaction(() => {
            db.prepare(`UPDATE giveaway_participants SET is_winner = 0 WHERE giveaway_id = ?`).run(giveawayId);
            for (const wid of winnerIds) {
                db.prepare(`UPDATE giveaway_participants SET is_winner = 1 WHERE id = ?`).run(wid);
            }
            db.prepare(`UPDATE giveaways SET status = 'finished' WHERE id = ?`).run(giveawayId);
        });
        tx();

        res.json({ success: true, winners, message: `Выбрано ${winners.length} победителей` });
    } catch (error) {
        console.error("Ошибка завершения розыгрыша:", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// Получить участников розыгрыша
app.get("/api/giveaways/:id/participants", (req, res) => {
    try {
        const giveawayId = Number(req.params.id);
        const participants = db.prepare(`SELECT * FROM giveaway_participants WHERE giveaway_id = ? ORDER BY id ASC`).all(giveawayId);
        res.json({ success: true, participants });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// =========================================================
// 404 / ERROR HANDLERS
// =========================================================

app.use((req, res) => {
    res.status(404).json({ success: false, error: `Endpoint не найден: ${req.method} ${req.path}` });
});

app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ success: false, error: "Внутренняя ошибка сервера" });
});

// =========================================================
// START
// =========================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
