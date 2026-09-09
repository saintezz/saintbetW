const fs = require("fs");
const path = require("path");

app.use(express.static(__dirname, {
    index: false
}));

function getPatchedIndexHtml() {
    const indexPath = path.join(__dirname, "index.html");

    if (!fs.existsSync(indexPath)) {
        return null;
    }

    let html = fs.readFileSync(indexPath, "utf8");

    const injectedScript = `
<script>
(function () {

    const PROMO_API_BASE =
        window.API_BASE_URL ||
        window.location.origin;

    function promoTelegramInitData() {
        try {
            return window.Telegram &&
                   window.Telegram.WebApp
                ? (
                    window.Telegram.WebApp.initData || ""
                  )
                : "";
        } catch (e) {
            return "";
        }
    }

    async function promoApi(url, options) {

        const opts = options || {};

        const headers = Object.assign(
            {},
            opts.headers || {},
            {
                "Content-Type": "application/json",
                "X-Telegram-Init-Data":
                    promoTelegramInitData()
            }
        );

        const response = await fetch(
            PROMO_API_BASE + url,
            Object.assign({}, opts, {
                headers
            })
        );

        const text = await response.text();

        let data = null;

        try {
            data = text
                ? JSON.parse(text)
                : null;
        } catch (e) {

            throw new Error(
                "Сервер вернул некорректный ответ (не JSON). Код: " +
                response.status
            );
        }

        if (!response.ok) {

            const error = new Error(
                data && data.error
                    ? data.error
                    : "Ошибка сервера: " +
                      response.status
            );

            error.status = response.status;
            error.data = data;

            throw error;
        }

        return data;
    }

    window.redeemPromoCode =
        async function () {

        const input =
            document.getElementById(
                "promoInput"
            );

        const message =
            document.getElementById(
                "promoMessage"
            );

        const button =
            document.querySelector(
                ".promo-button"
            );

        const code =
            String(
                input &&
                input.value ||
                ""
            )
            .trim()
            .toUpperCase();

        if (!message) {
            return;
        }

        if (!code) {

            message.className =
                "promo-message error";

            message.textContent =
                "Введи промокод.";

            return;
        }

        if (button) {
            button.disabled = true;
        }

        message.className =
            "promo-message";

        message.textContent =
            "Проверяем промокод...";

        try {

            const data =
                await promoApi(
                    "/api/promo/redeem",
                    {
                        method: "POST",

                        body: JSON.stringify({
                            code: code
                        })
                    }
                );

            message.className =
                "promo-message success";

            message.textContent =
                "Промокод активирован! +" +
                Number(data.reward || 0) +
                " 🦴";

            if (
                typeof balance !==
                "undefined"
            ) {
                balance =
                    Number(
                        data.balance || 0
                    );
            }

            if (
                typeof saveProfileData ===
                "function"
            ) {
                saveProfileData();
            }

            if (
                typeof renderAll ===
                "function"
            ) {
                renderAll();
            }

            if (
                typeof updateTop ===
                "function"
            ) {
                updateTop();
            }

            if (input) {
                input.value = "";
            }

        } catch (error) {

            message.className =
                "promo-message error";

            message.textContent =
                error.message ||
                "Ошибка активации промокода.";

        } finally {

            if (button) {
                button.disabled = false;
            }
        }
    };

    window.createPromoCode =
        async function () {

        const codeInput =
            document.getElementById(
                "adminPromoCode"
            );

        const activationsInput =
            document.getElementById(
                "adminPromoActivations"
            );

        const minutesInput =
            document.getElementById(
                "adminPromoMinutes"
            );

        const rewardInput =
            document.getElementById(
                "adminPromoReward"
            );

        const message =
            document.getElementById(
                "adminMessage"
            );

        if (!message) {
            return;
        }

        const code =
            String(
                codeInput &&
                codeInput.value ||
                ""
            )
            .trim()
            .toUpperCase();

        const maxActivations =
            Math.floor(
                Number(
                    activationsInput &&
                    activationsInput.value
                )
            );

        const minutes =
            Math.floor(
                Number(
                    minutesInput &&
                    minutesInput.value
                )
            );

        const reward =
            Math.floor(
                Number(
                    rewardInput &&
                    rewardInput.value
                )
            );

        if (!code) {

            message.textContent =
                "Укажи название промокода.";

            return;
        }

        if (
            maxActivations < 1 ||
            minutes < 1 ||
            reward < 1
        ) {

            message.textContent =
                "Активации, минуты и награда должны быть больше 0.";

            return;
        }

        message.textContent =
            "Создаём промокод...";

        try {

            await promoApi(
                "/api/admin/promos",
                {
                    method: "POST",

                    body: JSON.stringify({
                        code:
                            code,

                        max_activations:
                            maxActivations,

                        expires_in_minutes:
                            minutes,

                        reward:
                            reward
                    })
                }
            );

            message.textContent =
                "Промокод " +
                code +
                " создан!";

            if (codeInput) {
                codeInput.value = "";
            }

            if (activationsInput) {
                activationsInput.value = "";
            }

            if (minutesInput) {
                minutesInput.value = "";
            }

            if (rewardInput) {
                rewardInput.value = "10";
            }

            await window.renderAdminPromos();

        } catch (error) {

            message.textContent =
                error.message ||
                "Не удалось создать промокод.";
        }
    };

    window.renderAdminPromos =
        async function () {

        const list =
            document.getElementById(
                "adminPromoList"
            );

        if (!list) {
            return;
        }

        let admin = false;

        try {

            admin =
                typeof isAdmin ===
                "function" &&
                isAdmin();

        } catch (e) {}

        if (!admin) {

            list.innerHTML = "";

            return;
        }

        list.innerHTML =
            '<div class="admin-subtitle">' +
            'Загрузка промокодов...' +
            '</div>';

        try {

            const data =
                await promoApi(
                    "/api/admin/promos",
                    {
                        method: "GET"
                    }
                );

            const promos =
                Array.isArray(data.promos)
                    ? data.promos
                    : [];

            if (!promos.length) {

                list.innerHTML =
                    '<div class="admin-subtitle">' +
                    'Промокодов пока нет.' +
                    '</div>';

                return;
            }

            list.innerHTML =
                promos.map(
                    function (p) {

                    const expired =
                        Date.now() >=
                        Number(
                            p.expires_at
                        );

                    return (
                        '<div class="admin-withdrawal">' +

                        '<div class="admin-withdrawal-title">' +
                        (
                            typeof escapeHtml ===
                            "function"
                                ? escapeHtml(
                                    String(p.code)
                                  )
                                : String(p.code)
                        ) +
                        '</div>' +

                        '<div class="admin-withdrawal-meta">' +

                        (
                            expired
                                ? "⌛ ИСТЁК"
                                : "✓ АКТИВЕН"
                        ) +

                        " • " +

                        Number(
                            p.used_count || 0
                        ) +

                        "/" +

                        Number(
                            p.max_activations || 0
                        ) +

                        " активаций • " +

                        Number(
                            p.reward || 0
                        ) +

                        " 🦴</div>" +

                        '<div class="admin-withdrawal-details">' +

                        "Истекает: " +

                        new Date(
                            Number(
                                p.expires_at
                            )
                        ).toLocaleString(
                            "ru-RU"
                        ) +

                        "</div>" +

                        "</div>"
                    );
                }
            ).join("");

        } catch (error) {

            list.innerHTML =
                '<div class="admin-subtitle">' +
                "Ошибка загрузки промокодов: " +
                (
                    typeof escapeHtml ===
                    "function"
                        ? escapeHtml(
                            error.message ||
                            "ошибка"
                          )
                        : String(
                            error.message ||
                            "ошибка"
                          )
                ) +
                "</div>";
        }
    };

    setTimeout(
        function () {

            if (
                typeof window.renderAdminPromos ===
                "function"
            ) {
                window.renderAdminPromos();
            }

        },
        300
    );

})();
</script>`;

    if (html.includes("</body>")) {

        html =
            html.replace(
                "</body>",
                injectedScript +
                "\n</body>"
            );

    } else {

        html += injectedScript;
    }

    return html;
}

app.get("/", (req, res) => {

    const html =
        getPatchedIndexHtml();

    if (html !== null) {

        return res
            .type("html")
            .send(html);
    }

    res.json({
        status: "ok",
        message:
            "Telegram Mini App API работает!",
        database: "ok"
    });
});

app.get("/index.html", (req, res) => {

    const html =
        getPatchedIndexHtml();

    if (html === null) {

        return res
            .status(404)
            .send("index.html не найден");
    }

    res
        .type("html")
        .send(html);
});
