// src/api/documents.js
import { http } from "./http";

const GKEY = "guest_session";

/* ---------- local storage ---------- */
export function loadGuestToken() {
    try {
        const raw = localStorage.getItem(GKEY);
        if (!raw) return "";
        const j = JSON.parse(raw);
        return j?.guest_token || "";
    } catch {
        return "";
    }
}

function saveGuest(sess) {
    try {
        if (!sess) localStorage.removeItem(GKEY);
        else localStorage.setItem(GKEY, JSON.stringify(sess));
    } catch {}
}

export function clearGuest() {
    saveGuest(null);
}

function isGuestExpired(sess) {
    // если токена нет — явно протухло
    if (!sess?.guest_token) return true;
    // если нет expires_at — считаем бессрочным (бекенд сейчас его не шлёт)
    if (!sess?.expires_at) return false;
    const exp = new Date(sess.expires_at).getTime();
    return Number.isNaN(exp) || Date.now() > exp;
}

/* ---------- guest ---------- */
export async function ensureGuest() {
    let sess;
    try {
        sess = JSON.parse(localStorage.getItem(GKEY) || "null");
    } catch {
        sess = null;
    }

    if (!sess || isGuestExpired(sess)) {
        const res = await http.post("/documents/guest/start", {});
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json(); // { guest_token }
        saveGuest(data);
        sess = data;
    }

    return sess.guest_token;
}

export async function claimGuestDocuments() {
    const guest_token = loadGuestToken();
    if (!guest_token) return { moved: 0 };

    const res = await http.post("/documents/guest/claim", { guest_token });
    if (!res.ok) throw new Error(await res.text());
    const j = await res.json();
    if (j?.moved > 0) clearGuest();
    return j;
}

/* ---------- user upload ---------- */
export async function uploadUserDocument(file, meta = {}) {
    if (!file) throw new Error("Файл не передан");
    const tokens = http.getTokens?.();
    if (!tokens?.access_token) throw new Error("Требуется авторизация");

    const form = new FormData();
    form.append("file", file);
    Object.entries(meta || {}).forEach(([k, v]) => form.append(k, String(v)));

    const res = await fetch(http.baseURL + "/documents/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        body: form,
        credentials: "include",
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

/* ---------- guest upload с авто-лечением Invalid guest token ---------- */
export async function uploadGuestDocument(file, meta = {}) {
    if (!file) throw new Error("Файл не передан");

    const doUpload = async () => {
        const guest = await ensureGuest();

        const form = new FormData();
        form.append("file", file);
        Object.entries(meta || {}).forEach(([k, v]) => form.append(k, String(v)));

        const res = await fetch(http.baseURL + "/documents/upload", {
            method: "POST",
            headers: { "X-Guest-Token": guest },
            body: form,
            credentials: "include",
        });
        return res;
    };

    // первая попытка
    let res = await doUpload();

    // если токен гостя протух/удалён на бекенде — подчистим и попробуем ещё раз
    if (res.status === 401) {
        let bodyText = "";
        try {
            bodyText = await res.text();
        } catch {
            bodyText = "";
        }

        if (bodyText.includes("Invalid guest token")) {
            // старый токен больше не валиден — чистим и заводим нового гостя
            clearGuest();
            res = await doUpload();
        } else {
            throw new Error(bodyText || "Guest upload failed");
        }
    }

    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

/* ---------- user list (если нужна отдельная страница со списком) ---------- */
export async function listMyDocuments() {
    const res = await http.get("/documents/list");
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

/* ---------- опционально ---------- */
export async function deleteDocument(id) {
    const res = await http.del(`/documents/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(await res.text());
    try {
        return await res.json();
    } catch {
        return { ok: true };
    }
}

export function downloadUrl(id) {
    return `${http.baseURL}/documents/${encodeURIComponent(id)}/download`;
}
