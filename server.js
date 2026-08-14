const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");

const app = express();

app.use(cors());
app.use(express.json());

const db = new Database("database.db");

// Таблица игроков
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT UNIQUE NOT NULL,
        username TEXT,
        roblox_name TEXT,
        balance INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Таблица инвентаря
db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        inventory_type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Таблица выводов
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

app.get("/", (req, res) => {
    res.json({
        status: "ok",
        message: "Telegram Mini App API работает!",
        database: "ok"
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
