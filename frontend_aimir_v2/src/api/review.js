// src/api/reviews.js
import { http } from "./http";

/* ========== ПУБЛИЧНЫЕ ========== */

/** Список опубликованных отзывов (для главной). Поддерживает пагинацию. */
export async function listPublishedReviews({ limit = 20, offset = 0 } = {}) {
    const qs = new URLSearchParams({ limit, offset }).toString();
    const res = await http.get(`/reviews?${qs}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { total, items: ReviewOut[] }
}

/** Получить один опубликованный отзыв по id */
export async function getPublishedReview(id) {
    const res = await http.get(`/reviews/${id}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // ReviewOut
}

/** Публичная отправка нового отзыва (published всегда false на бэке) */
export async function createReview({ email, title, description, rating }) {
    const body = { email, title, description, rating };
    const res = await http.post("/reviews", body);
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // ReviewOut
}

/* ========== АДМИН (owner=true) ========== */

/**
 * Админ-листинг всех отзывов.
 * @param {Object} params
 * @param {number} params.limit
 * @param {number} params.offset
 * @param {boolean|null} params.published  true/false для фильтра или null — все
 * @param {string} params.search  поиск по email/title (ILIKE)
 */
export async function adminListReviews({
                                           limit = 50,
                                           offset = 0,
                                           published = null,
                                           search = "",
                                       } = {}) {
    const sp = new URLSearchParams();
    sp.set("limit", String(limit));
    sp.set("offset", String(offset));
    if (published !== null) sp.set("published", String(Boolean(published)));
    if (search) sp.set("search", search);

    const res = await http.get(`/reviews/admin?${sp.toString()}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { total, items }
}

/** Админ: частичное обновление отзыва */
export async function adminUpdateReview(id, patch) {
    // patch: { email?, title?, description?, rating? }

    // ---- ОБНОВЛЕНО: сначала пробуем настоящий PATCH ----
    let res = await http.patch(`/reviews/${id}`, patch);

    // сохраняем прежнюю «подстраховку» на случай, если бэкенд вдруг не примет PATCH
    if (res.status === 405) {
        // если сервер строго ждёт другой метод:
        res = await http.post(`/reviews/${id}?_method=PATCH`, patch);
    }

    if (!res.ok) throw new Error(await res.text());
    return res.json(); // ReviewOut
}

/** Админ: опубликовать/скрыть отзыв */
export async function adminSetPublish(id, published) {
    // ---- ОБНОВЛЕНО: используем PATCH, как на бэке ----
    let res = await http.patch(`/reviews/${id}/publish`, { published });

    // оставим fallback, чтобы не ломать идею с _method, если тебе когда-нибудь понадобится
    if (res.status === 405) {
        res = await http.post(`/reviews/${id}/publish?_method=PATCH`, { published });
    }

    if (!res.ok) throw new Error(await res.text());
    return res.json(); // ReviewOut
}

/** Админ: удалить отзыв */
export async function adminDeleteReview(id) {
    const res = await http.del(`/reviews/${id}`);
    if (!res.ok) throw new Error(await res.text());
    return true;
}
