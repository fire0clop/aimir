// src/api/billing.js
import { http } from "./http";

/** Цены из .env бэка (для отображения на фронте) */
export async function getPrices() {
    const res = await http.get("/billing/prices");
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { sub_month, sub_6m, sub_year, request_price }
}

/** Текущий статус пользователя: подписка и кредиты */
export async function getBillingStatus() {
    const res = await http.get("/billing/me");
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { has_subscription, subscription_start, subscription_end, active, credits }
}

/**
 * СТАРЫЙ способ: оформить/продлить подписку БЕЗ оплаты (мгновенно).
 * Оставляем для тестов/отладки.
 * @param {"month"|"6m"|"year"} plan
 */
export async function subscribe(plan) {
    const res = await http.post("/billing/subscribe", { plan });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // BillingStatus
}

/**
 * СТАРЫЙ способ: купить N «запросов» (кредитов) БЕЗ оплаты (мгновенно).
 * @param {number} quantity — целое > 0
 */
export async function addCredits(quantity) {
    const res = await http.post("/billing/credits/add", { quantity });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // BillingStatus
}

/**
 * НОВОЕ: инициация оплаты подписки через T-Банк.
 * Бэк вернёт payment_url, payment_id, order_id, amount_rub.
 * @param {"month"|"6m"|"year"} plan
 */
export async function subscribePay(plan) {
    const res = await http.post("/billing/subscribe/pay", { plan });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { payment_url, payment_id, order_id, plan, amount_rub }
}

/**
 * НОВОЕ: инициация оплаты кредитов через T-Банк.
 * Бэк вернёт payment_url, payment_id, order_id, amount_rub, quantity.
 * @param {number} quantity — целое > 0
 */
export async function creditsPay(quantity) {
    const res = await http.post("/billing/credits/pay", { quantity });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { payment_url, payment_id, order_id, quantity, amount_rub }
}
