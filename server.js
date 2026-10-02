const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
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

db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        inventory_type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        username TEXT,
        item_id INTEGER NOT NULL,
        item_name TEXT,
        item_price INTEGER DEFAULT 0,
        mutation TEXT,
        roblox_name TEXT NOT NULL,
        ready_time TEXT NOT NULL,
        comment TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME
    )
`);
try { db.exec("ALTER TABLE withdrawals ADD COLUMN username TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE withdrawals ADD COLUMN item_name TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE withdrawals ADD COLUMN item_price INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE withdrawals ADD COLUMN mutation TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE withdrawals ADD COLUMN processed_at DATETIME"); } catch(e) {}

db.exec(`
    CREATE TABLE IF NOT EXISTS shop_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        stock INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

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

db.exec(`
    CREATE TABLE IF NOT EXISTS promo_activations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        telegram_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(code, telegram_id)
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS promo_contributions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        code TEXT NOT NULL,
        amount INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS stats (
        telegram_id TEXT PRIMARY KEY,
        upgrades INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS live_feed (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        username TEXT,
        item_name TEXT NOT NULL,
        item_price INTEGER NOT NULL DEFAULT 0,
        chance REAL NOT NULL DEFAULT 0,
        source_name TEXT,
        source_price INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);
try { db.exec("CREATE INDEX IF NOT EXISTS idx_live_feed_created ON live_feed (created_at DESC)"); } catch(e) {}

// =========================================================
// TELEGRAM / AUTH
// =========================================================

const ADMIN_USERNAMES = ["saintezz7", "wanterfenttopchik"];

function getTelegramUser(initData) {
    try {
        const params = new URLSearchParams(initData);
        const userString = params.get("user");
        if (!userString) return null;
        return JSON.parse(userString);
    } catch (error) { return null; }
}

function resolveUserFromRequest(req) {
    let telegramId = null, username = null, firstName = null;
    const initData = req.headers["x-telegram-init-data"];
    if (initData) {
        const tgUser = getTelegramUser(initData);
        if (tgUser && tgUser.id) {
            telegramId = String(tgUser.id);
            username = tgUser.username ? String(tgUser.username).toLowerCase() : null;
            firstName = tgUser.first_name ? String(tgUser.first_name) : null;
        }
    }
    if (!telegramId && req.body) {
        telegramId = req.body.telegram_id ? String(req.body.telegram_id).trim() : null;
        if (!telegramId && req.body.username) telegramId = String(req.body.username).trim();
        if (req.body.username && !username) username = String(req.body.username).trim().toLowerCase();
        if (req.body.first_name && !firstName) firstName = String(req.body.first_name).trim();
    }
    if (!telegramId) telegramId = req.headers["x-user-id"] || null;
    if (!telegramId) telegramId = "user_" + (req.ip || "local").replace(/[^a-zA-Z0-9]/g, "");
    return { telegramId, username, firstName };
}

function isAdminRequest(req) {
    const { username } = resolveUserFromRequest(req);
    if (username && ADMIN_USERNAMES.includes(username)) return true;
    const header = req.headers["x-admin-username"];
    if (header && ADMIN_USERNAMES.includes(String(header).toLowerCase())) return true;
    return false;
}

function ensureUser(telegramId, username, firstName) {
    let user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
    if (!user) {
        db.prepare(`INSERT INTO users (telegram_id, username, first_name, balance) VALUES (?, ?, ?, 0)`)
          .run(telegramId, username || null, firstName || null);
        user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
    } else if (username || firstName) {
        db.prepare(`UPDATE users SET username = COALESCE(?, username), first_name = COALESCE(?, first_name) WHERE telegram_id = ?`)
          .run(username || null, firstName || null, telegramId);
        user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
    }
    return user;
}

function ensureStats(telegramId) {
    let row = db.prepare(`SELECT * FROM stats WHERE telegram_id = ?`).get(telegramId);
    if (!row) {
        db.prepare(`INSERT INTO stats (telegram_id) VALUES (?)`).run(telegramId);
        row = db.prepare(`SELECT * FROM stats WHERE telegram_id = ?`).get(telegramId);
    }
    return row;
}

// =========================================================
// MAIN
// =========================================================

app.get(["/", "/index.html"], (req, res) => {
    const indexPath = path.join(__dirname, "index.html");
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
    res.json({ status: "ok", message: "Saint UP API работает!", database: "ok" });
});

app.get("/api/health", (req, res) => {
    res.json({ success: true, status: "ok", time: new Date().toISOString() });
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
        ensureStats(telegramId);
        const user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
        res.json({ success: true, user });
    } catch (error) {
        console.error("[USER]", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.get("/api/user/:telegram_id", (req, res) => {
    try {
        const telegramId = String(req.params.telegram_id);
        ensureStats(telegramId);
        const user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
        if (!user) return res.status(404).json({ success: false, error: "Игрок не найден" });
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// =========================================================
// BALANCE
// =========================================================

app.post("/api/balance/update", (req, res) => {
    try {
        const { telegramId, username, firstName } = resolveUserFromRequest(req);
        const delta = Number(req.body.delta);
        if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ success: false, error: "delta обязателен" });
        ensureUser(telegramId, username, firstName);
        const user = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
        const before = Number(user.balance) || 0;
        const after = before + delta;
        if (after < 0) return res.status(400).json({ success: false, error: "Недостаточно средств", balance: before });
        db.prepare(`UPDATE users SET balance = ? WHERE telegram_id = ?`).run(after, telegramId);
        res.json({ success: true, balance: after, delta, before });
    } catch (error) {
        console.error("[BALANCE UPDATE]", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// =========================================================
// STATS
// =========================================================

app.get("/api/stats/:telegram_id", (req, res) => {
    try {
        const telegramId = String(req.params.telegram_id);
        const stats = ensureStats(telegramId);
        const winrate = stats.upgrades > 0 ? Math.round((stats.wins / stats.upgrades) * 100) : 0;
        res.json({ success: true, stats: { ...stats, winrate } });
    } catch (error) { res.status(500).json({ success: false, error: "Ошибка сервера" }); }
});

app.post("/api/stats/upgrade", (req, res) => {
    try {
        const { telegramId, username, firstName } = resolveUserFromRequest(req);
        const result = String(req.body.result || '').toLowerCase();
        if (result !== 'win' && result !== 'lose') return res.status(400).json({ success: false, error: "result: win|lose" });
        const sourceName = req.body.source_name ? String(req.body.source_name) : null;
        const sourcePrice = Math.max(0, Math.floor(Number(req.body.source_price) || 0));
        const targetName = req.body.target_name ? String(req.body.target_name) : null;
        const targetPrice = Math.max(0, Math.floor(Number(req.body.target_price) || 0));
        const chance = Number(req.body.chance) || 0;
        ensureUser(telegramId, username, firstName);
        ensureStats(telegramId);
        const tx = db.transaction(() => {
            if (result === 'win') {
                db.prepare(`UPDATE stats SET upgrades = upgrades + 1, wins = wins + 1, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?`).run(telegramId);
                db.prepare(`INSERT INTO live_feed (telegram_id, username, item_name, item_price, chance, source_name, source_price) VALUES (?, ?, ?, ?, ?, ?, ?)`)
                  .run(telegramId, username || null, targetName || '—', targetPrice, chance, sourceName, sourcePrice);
            } else {
                db.prepare(`UPDATE stats SET upgrades = upgrades + 1, losses = losses + 1, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?`).run(telegramId);
            }
        });
        tx();
        const stats = ensureStats(telegramId);
        const winrate = stats.upgrades > 0 ? Math.round((stats.wins / stats.upgrades) * 100) : 0;
        res.json({ success: true, stats: { ...stats, winrate } });
    } catch (error) {
        console.error("[STATS UPGRADE]", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// =========================================================
// LIVE FEED
// =========================================================

app.get("/api/live-feed", (req, res) => {
    try {
        const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
        const rows = db.prepare(`SELECT id, telegram_id, username, item_name, item_price, chance, source_name, source_price, created_at FROM live_feed ORDER BY id DESC LIMIT ?`).all(limit);
        res.json({ success: true, feed: rows });
    } catch (error) { res.status(500).json({ success: false, error: "Ошибка сервера" }); }
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
        db.prepare(`INSERT INTO inventory (telegram_id, item_id, inventory_type) VALUES (?, ?, ?)`).run(String(telegram_id), Number(item_id), type);
        res.json({ success: true, message: "Предмет добавлен" });
    } catch (error) { res.status(500).json({ success: false, error: "Ошибка сервера" }); }
});

app.get("/api/inventory/:telegram_id", (req, res) => {
    try {
        const telegramId = String(req.params.telegram_id);
        const inventory = db.prepare(`SELECT * FROM inventory WHERE telegram_id = ? ORDER BY id ASC`).all(telegramId);
        res.json({ success: true, inventory });
    } catch (error) { res.status(500).json({ success: false, error: "Ошибка сервера" }); }
});

app.post("/api/inventory/sell", (req, res) => {
    try {
        const { telegram_id, inventory_id, price } = req.body;
        if (!telegram_id || !inventory_id) return res.status(400).json({ success: false, error: "Не хватает данных" });
        const item = db.prepare(`SELECT * FROM inventory WHERE id = ? AND telegram_id = ? AND inventory_type = 'upgrader'`).get(Number(inventory_id), String(telegram_id));
        if (!item) return res.status(404).json({ success: false, error: "Предмет не найден" });
        const sellPrice = Number(price) || 0;
        const transaction = db.transaction(() => {
            db.prepare(`DELETE FROM inventory WHERE id = ? AND telegram_id = ?`).run(Number(inventory_id), String(telegram_id));
            db.prepare(`UPDATE users SET balance = balance + ? WHERE telegram_id = ?`).run(sellPrice, String(telegram_id));
        });
        transaction();
        res.json({ success: true, message: "Предмет продан", received: sellPrice });
    } catch (error) { res.status(500).json({ success: false, error: "Ошибка сервера" }); }
});

// =========================================================
// WITHDRAWALS — юзер
// =========================================================

app.post("/api/withdrawals", (req, res) => {
    try {
        const { telegram_id, inventory_id, item_id, item_name, item_price, mutation, roblox_name, ready_time, comment } = req.body;
        if (!telegram_id) return res.status(400).json({ success: false, error: "telegram_id обязателен" });
        if (!item_id && !inventory_id) return res.status(400).json({ success: false, error: "Не указан предмет" });
        if (!roblox_name || !roblox_name.trim()) return res.status(400).json({ success: false, error: "Укажите Roblox ник" });
        if (!ready_time || !ready_time.trim()) return res.status(400).json({ success: false, error: "Укажите время" });

        const telegramId = String(telegram_id);
        const { username } = resolveUserFromRequest(req);

        let finalItemId = item_id;
        let finalItemName = item_name || null;
        let finalItemPrice = Number(item_price) || 0;
        let finalMutation = mutation || null;

        if (inventory_id) {
            const invItem = db.prepare(`SELECT * FROM inventory WHERE id = ? AND telegram_id = ? AND inventory_type = 'upgrader'`).get(Number(inventory_id), telegramId);
            if (!invItem) return res.status(404).json({ success: false, error: "Предмет не найден" });
            finalItemId = invItem.item_id;
            db.prepare(`DELETE FROM inventory WHERE id = ? AND telegram_id = ?`).run(Number(inventory_id), telegramId);
        }

        const result = db.prepare(`
            INSERT INTO withdrawals (telegram_id, username, item_id, item_name, item_price, mutation, roblox_name, ready_time, comment, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `).run(telegramId, username || null, Number(finalItemId), finalItemName, finalItemPrice, finalMutation, roblox_name.trim(), ready_time.trim(), comment ? comment.trim() : null);

        res.json({ success: true, withdrawal_id: result.lastInsertRowid, message: "Заявка создана" });
    } catch (error) {
        console.error("[WITHDRAW CREATE]", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.get("/api/withdrawals/:telegram_id", (req, res) => {
    try {
        const telegramId = String(req.params.telegram_id);
        const withdrawals = db.prepare(`SELECT * FROM withdrawals WHERE telegram_id = ? ORDER BY id DESC`).all(telegramId);
        res.json({ success: true, withdrawals });
    } catch (error) { res.status(500).json({ success: false, error: "Ошибка сервера" }); }
});

// =========================================================
// WITHDRAWALS — админ
// =========================================================

app.get("/api/admin/withdrawals", (req, res) => {
    try {
        if (!isAdminRequest(req)) return res.status(403).json({ success: false, error: "Доступ запрещён" });
        const status = req.query.status ? String(req.query.status) : null;
        let rows;
        if (status && status !== 'all') {
            rows = db.prepare(`SELECT * FROM withdrawals WHERE status = ? ORDER BY id DESC LIMIT 500`).all(status);
        } else {
            rows = db.prepare(`SELECT * FROM withdrawals ORDER BY id DESC LIMIT 500`).all();
        }
        res.json({ success: true, withdrawals: rows });
    } catch (error) {
        console.error("[ADMIN WITHDRAWALS LIST]", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.post("/api/admin/withdrawals/:id/accept", (req, res) => {
    try {
        if (!isAdminRequest(req)) return res.status(403).json({ success: false, error: "Доступ запрещён" });
        const id = Number(req.params.id);
        const w = db.prepare(`SELECT * FROM withdrawals WHERE id = ?`).get(id);
        if (!w) return res.status(404).json({ success: false, error: "Заявка не найдена" });
        if (w.status !== 'pending') return res.status(400).json({ success: false, error: "Уже обработано" });
        db.prepare(`UPDATE withdrawals SET status = 'accepted', processed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
        const updated = db.prepare(`SELECT * FROM withdrawals WHERE id = ?`).get(id);
        res.json({ success: true, withdrawal: updated, message: "Вывод принят" });
    } catch (error) {
        console.error("[ADMIN WITHDRAW ACCEPT]", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.post("/api/admin/withdrawals/:id/reject", (req, res) => {
    try {
        if (!isAdminRequest(req)) return res.status(403).json({ success: false, error: "Доступ запрещён" });
        const id = Number(req.params.id);
        const w = db.prepare(`SELECT * FROM withdrawals WHERE id = ?`).get(id);
        if (!w) return res.status(404).json({ success: false, error: "Заявка не найдена" });
        if (w.status !== 'pending') return res.status(400).json({ success: false, error: "Уже обработано" });
        db.prepare(`UPDATE withdrawals SET status = 'rejected', processed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
        const updated = db.prepare(`SELECT * FROM withdrawals WHERE id = ?`).get(id);
        res.json({ success: true, withdrawal: updated, message: "Вывод отклонён" });
    } catch (error) {
        console.error("[ADMIN WITHDRAW REJECT]", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

app.post("/api/admin/withdrawals/:id/complete", (req, res) => {
    try {
        if (!isAdminRequest(req)) return res.status(403).json({ success: false, error: "Доступ запрещён" });
        const id = Number(req.params.id);
        const w = db.prepare(`SELECT * FROM withdrawals WHERE id = ?`).get(id);
        if (!w) return res.status(404).json({ success: false, error: "Заявка не найдена" });
        db.prepare(`UPDATE withdrawals SET status = 'completed', processed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
        const updated = db.prepare(`SELECT * FROM withdrawals WHERE id = ?`).get(id);
        res.json({ success: true, withdrawal: updated, message: "Вывод завершён" });
    } catch (error) {
        console.error("[ADMIN WITHDRAW COMPLETE]", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// =========================================================
// ADMIN — PROMO CODES
// =========================================================

app.get(["/api/admin/promos", "/api/admin/promo-codes"], (req, res) => {
    try {
        const promoCodes = db.prepare(`
            SELECT id, code,
                COALESCE(max_activations, activations, 1) AS max_activations,
                COALESCE(used_count, used, 0) AS used_count,
                reward, COALESCE(expires_at, 0) AS expires_at, created_at
            FROM promo_codes ORDER BY id DESC
        `).all();
        res.json({ success: true, promos: promoCodes, promoCodes });
    } catch (error) { res.status(500).json({ success: false, error: "Ошибка сервера" }); }
});

app.post(["/api/admin/promos", "/api/admin/promo-codes"], (req, res) => {
    try {
        const { code, max_activations, activations, expires_in_minutes, reward } = req.body;
        if (!code || !String(code).trim()) return res.status(400).json({ success: false, error: "Укажите название" });
        const codeUpper = String(code).trim().toUpperCase();
        const acts = Math.floor(Number(max_activations !== undefined ? max_activations : activations));
        const rew = Math.floor(Number(reward !== undefined ? reward : 10));
        const minutes = Number(expires_in_minutes);
        if (isNaN(acts) || acts < 1) return res.status(400).json({ success: false, error: "Активаций > 0" });
        if (isNaN(rew) || rew < 1) return res.status(400).json({ success: false, error: "Награда > 0" });
        let expiresAt = 0;
        if (!isNaN(minutes) && minutes > 0) expiresAt = Date.now() + Math.floor(minutes * 60 * 1000);
        const existing = db.prepare(`SELECT id FROM promo_codes WHERE code = ?`).get(codeUpper);
        if (existing) return res.status(400).json({ success: false, error: "Такой промокод уже есть" });
        const result = db.prepare(`INSERT INTO promo_codes (code, max_activations, activations, used_count, used, reward, expires_at) VALUES (?, ?, ?, 0, 0, ?, ?)`)
          .run(codeUpper, acts, acts, rew, expiresAt);
        const newPromo = db.prepare(`SELECT id, code, COALESCE(max_activations, activations, 1) AS max_activations, COALESCE(used_count, used, 0) AS used_count, reward, COALESCE(expires_at, 0) AS expires_at, created_at FROM promo_codes WHERE id = ?`).get(result.lastInsertRowid);
        res.json({ success: true, promo: newPromo, promoCode: newPromo, message: `Промокод ${codeUpper} создан!` });
    } catch (error) { res.status(500).json({ success: false, error: "Ошибка сервера" }); }
});

app.delete(["/api/admin/promos/:id", "/api/admin/promo-codes/:id"], (req, res) => {
    try {
        const id = Number(req.params.id);
        const promo = db.prepare(`SELECT code FROM promo_codes WHERE id = ?`).get(id);
        const result = db.prepare(`DELETE FROM promo_codes WHERE id = ?`).run(id);
        if (result.changes === 0) return res.status(404).json({ success: false, error: "Промокод не найден" });
        if (promo && promo.code) { try { db.prepare(`DELETE FROM promo_activations WHERE code = ?`).run(promo.code); } catch(e) {} }
        res.json({ success: true, message: "Промокод удалён" });
    } catch (error) { res.status(500).json({ success: false, error: "Ошибка сервера" }); }
});

// =========================================================
// PROMO REDEEM
// =========================================================

app.post(["/api/promo/redeem", "/api/promo-code/activate"], (req, res) => {
    try {
        const { code } = req.body;
        if (!code || !String(code).trim()) return res.status(400).json({ success: false, error: "Укажите промокод" });
        const codeUpper = String(code).trim().toUpperCase();
        const { telegramId, username, firstName } = resolveUserFromRequest(req);
        const promo = db.prepare(`SELECT id, code, COALESCE(max_activations, activations, 1) AS max_activations, COALESCE(used_count, used, 0) AS used_count, reward, COALESCE(expires_at, 0) AS expires_at FROM promo_codes WHERE code = ?`).get(codeUpper);
        if (!promo) return res.status(404).json({ success: false, error: "Промокод не найден" });
        if (promo.expires_at > 0 && Date.now() > promo.expires_at) return res.status(410).json({ success: false, error: "Промокод истёк" });
        if (promo.used_count >= promo.max_activations) return res.status(409).json({ success: false, error: "Лимит исчерпан" });
        const alreadyUsed = db.prepare(`SELECT id FROM promo_activations WHERE code = ? AND telegram_id = ?`).get(codeUpper, telegramId);
        if (alreadyUsed) return res.status(409).json({ success: false, error: "Ты уже активировал этот промокод" });
        ensureUser(telegramId, username, firstName);
        const tx = db.transaction(() => {
            db.prepare(`UPDATE promo_codes SET used_count = COALESCE(used_count, 0) + 1, used = COALESCE(used, 0) + 1 WHERE id = ?`).run(promo.id);
            db.prepare(`INSERT INTO promo_activations (code, telegram_id) VALUES (?, ?)`).run(codeUpper, telegramId);
            db.prepare(`UPDATE users SET balance = balance + ? WHERE telegram_id = ?`).run(promo.reward, telegramId);
            try { db.prepare(`INSERT INTO promo_contributions (telegram_id, code, amount) VALUES (?, ?, ?)`).run(telegramId, codeUpper, promo.reward); } catch(e) {}
        });
        tx();
        const updatedUser = db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
        const finalBalance = updatedUser ? Number(updatedUser.balance) : promo.reward;
        res.json({ success: true, reward: promo.reward, balance: finalBalance, message: `Промокод активирован! +${promo.reward} 💎` });
    } catch (error) {
        console.error("[PROMO REDEEM]", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

// =========================================================
// 404 / ERROR
// =========================================================

app.use((req, res) => res.status(404).json({ success: false, error: `Endpoint не найден: ${req.method} ${req.path}` }));
app.use((error, req, res, next) => { console.error(error); res.status(500).json({ success: false, error: "Внутренняя ошибка сервера" }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Saint UP server started on port ${PORT}`));
