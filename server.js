const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Отдаём статику из папки public
app.use(express.static(path.join(__dirname, 'public')));

// История последних дропов (чтобы новый игрок увидел последние 20)
const recentDrops = [];
const MAX_HISTORY = 20;

// Хранилище всех подключений
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[+] Клиент подключился. Всего: ${clients.size}`);

    // Отправляем новому клиенту историю последних дропов
    ws.send(JSON.stringify({
        type: 'history',
        drops: recentDrops
    }));

    // Обработка сообщений от клиента
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            // Игрок выбил предмет в апгрейде
            if (msg.type === 'upgrade_win') {
                const drop = {
                    nickname: msg.nickname || 'Игрок',
                    itemId: msg.itemId,
                    itemName: msg.itemName,
                    itemImg: msg.itemImg,
                    price: msg.price,
                    timestamp: Date.now()
                };

                // Добавляем в историю
                recentDrops.unshift(drop);
                if (recentDrops.length > MAX_HISTORY) recentDrops.pop();

                // Рассылаем всем
                broadcast({
                    type: 'new_drop',
                    drop
                });
            }

            // Пинг для проверки соединения
            if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            }
        } catch (err) {
            console.error('Ошибка парсинга сообщения:', err);
        }
    });

    // Отключение
    ws.on('close', () => {
        clients.delete(ws);
        console.log(`[-] Клиент отключился. Всего: ${clients.size}`);
    });

    ws.on('error', (err) => {
        console.error('WebSocket ошибка:', err);
    });
});

// Рассылка всем подключённым клиентам
function broadcast(data) {
    const json = JSON.stringify(data);
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(json);
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 GGbrainX сервер запущен на http://localhost:${PORT}`);
    console.log(`📡 WebSocket слушает на ws://localhost:${PORT}`);
});
