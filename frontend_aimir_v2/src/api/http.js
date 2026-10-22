// src/api/http.js
const API = process.env.REACT_APP_API_URL || "/api";

const NETWORK_ERROR_MESSAGE = "Нет соединения с сервером. Проверьте интернет и попробуйте ещё раз.";

// fetch, который превращает сетевой сбой (TypeError: Failed to fetch)
// в понятное пользователю сообщение
async function safeFetch(url, options) {
    try {
        return await fetch(url, options);
    } catch {
        throw new Error(NETWORK_ERROR_MESSAGE);
    }
}

let _tokens = null;

function loadTokens() {
    if (_tokens) return _tokens;
    try {
        const raw = localStorage.getItem("tokens");
        _tokens = raw ? JSON.parse(raw) : null;
    } catch {
        _tokens = null;
    }
    return _tokens;
}

function getTokens() {
    return _tokens ?? loadTokens();
}

function setTokens(tokens) {
    _tokens = tokens || null;
    if (tokens) localStorage.setItem("tokens", JSON.stringify(tokens));
    else localStorage.removeItem("tokens");
}

function clearTokens() {
    setTokens(null);
}

// single-flight: параллельные 401 не должны запускать несколько рефрешей —
// иначе при ротации refresh-токена второй запрос разлогинит пользователя
let _refreshPromise = null;

async function refreshOnce() {
    if (!_refreshPromise) {
        _refreshPromise = (async () => {
            const rr = await safeFetch(API + "/users/refresh", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refresh_token: getTokens()?.refresh_token }),
            });
            if (!rr.ok) {
                clearTokens();
                return null;
            }
            const newTokens = await rr.json();
            setTokens(newTokens);
            return newTokens;
        })().finally(() => {
            _refreshPromise = null;
        });
    }
    return _refreshPromise;
}

async function request(path, options = {}, retry = true) {
    const headers = new Headers(options.headers || {});
    const t = getTokens();

    if (t?.access_token) headers.set("Authorization", `Bearer ${t.access_token}`);
    if (options.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    const res = await safeFetch(API + path, { ...options, headers });

    // нет 401 или нет попытки повтора — отдаем ответ как есть
    if (res.status !== 401 || !retry || !getTokens()?.refresh_token) return res;

    // пробуем рефреш (общий для всех параллельных запросов)
    let newTokens = null;
    try {
        newTokens = await refreshOnce();
    } catch {
        return res; // сетевой сбой рефреша — вернем исходный 401, токены не трогаем
    }
    if (!newTokens) return res; // рефреш отклонён — токены уже очищены

    // повтор запроса с новым access
    const headers2 = new Headers(options.headers || {});
    headers2.set("Authorization", `Bearer ${newTokens.access_token}`);
    if (options.body && !headers2.has("Content-Type")) {
        headers2.set("Content-Type", "application/json");
    }

    return safeFetch(API + path, { ...options, headers: headers2 });
}

export const http = {
    baseURL: API,
    get: (p) => request(p),
    post: (p, body) => request(p, { method: "POST", body: JSON.stringify(body) }),
    put: (p, body) => request(p, { method: "PUT", body: JSON.stringify(body) }),
    del: (p) => request(p, { method: "DELETE" }),

    // === добавили PATCH, логика та же, что у post/put ===
    patch: (p, body) => request(p, { method: "PATCH", body: JSON.stringify(body) }),

    getTokens,
    setTokens,
    clearTokens,
    loadTokens,
};
