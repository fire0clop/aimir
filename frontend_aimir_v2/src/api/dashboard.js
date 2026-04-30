import { http } from "./http";

/**
 * Общие данные для дашборда (подписки, выручка и т.д.)
 * GET /dashboard
 *
 * params:
 *  - startDate?: "YYYY-MM-DD"
 *  - endDate?: "YYYY-MM-DD"
 */
export async function fetchDashboard({ startDate, endDate } = {}) {
    const sp = new URLSearchParams();
    if (startDate) sp.set("start_date", startDate);
    if (endDate) sp.set("end_date", endDate);

    const qs = sp.toString();
    const url = qs ? `/dashboard?${qs}` : "/dashboard";

    const res = await http.get(url);

    if (res.status === 401 || res.status === 403) {
        const body = await res.text();
        let detail = body;
        try {
            const json = JSON.parse(body);
            detail = json.detail || body;
        } catch {
            // ignore
        }
        const err = new Error(detail || "Access denied");
        err.status = res.status;
        throw err;
    }

    if (!res.ok) {
        throw new Error(await res.text());
    }

    return res.json(); // { subscriptions, revenue }
}

/**
 * Только сводка по выручке (для верхних карточек в DashboardRevenue).
 * GET /dashboard
 *
 * params:
 *  - startDate?: "YYYY-MM-DD"
 *  - endDate?: "YYYY-MM-DD"
 *
 * Возвращает только json.revenue или {}.
 */
export async function fetchDashboardRevenueSummary({ startDate, endDate } = {}) {
    const sp = new URLSearchParams();
    if (startDate) sp.set("start_date", startDate);
    if (endDate) sp.set("end_date", endDate);

    const qs = sp.toString();
    const url = qs ? `/dashboard?${qs}` : "/dashboard";

    const res = await http.get(url);

    if (res.status === 401 || res.status === 403) {
        const body = await res.text();
        let detail = body;
        try {
            const json = JSON.parse(body);
            detail = json.detail || body;
        } catch {
            // ignore
        }
        const err = new Error(detail || "Access denied");
        err.status = res.status;
        throw err;
    }

    if (!res.ok) {
        throw new Error(await res.text());
    }

    const json = await res.json();
    return json.revenue || {};
}

/**
 * Сводка по пользователям, у которых есть хотя бы один документ.
 * GET /dashboard/users/summary
 */
export async function fetchDashboardUsersSummary() {
    const res = await http.get("/dashboard/users/summary");

    if (res.status === 401 || res.status === 403) {
        const body = await res.text();
        let detail = body;
        try {
            const json = JSON.parse(body);
            detail = json.detail || body;
        } catch {
            // ignore
        }
        const err = new Error(detail || "Access denied");
        err.status = res.status;
        throw err;
    }

    if (!res.ok) {
        throw new Error(await res.text());
    }

    return res.json(); // { items: [...] }
}

/**
 * Фактическая выручка по транзакциям.
 * GET /dashboard/revenue/timeseries
 *
 * params:
 *  - startDate?: "YYYY-MM-DD"
 *  - endDate?: "YYYY-MM-DD"
 *  - groupBy?: "day" | "month"
 */
export async function fetchDashboardRevenueTimeseries({
                                                          startDate,
                                                          endDate,
                                                          groupBy = "day",
                                                      } = {}) {
    const sp = new URLSearchParams();
    if (startDate) sp.set("start_date", startDate);
    if (endDate) sp.set("end_date", endDate);
    if (groupBy) sp.set("group_by", groupBy);

    const qs = sp.toString();
    const url = qs
        ? `/dashboard/revenue/timeseries?${qs}`
        : "/dashboard/revenue/timeseries";

    const res = await http.get(url);

    if (res.status === 401 || res.status === 403) {
        const body = await res.text();
        let detail = body;
        try {
            const json = JSON.parse(body);
            detail = json.detail || body;
        } catch {
            // ignore
        }
        const err = new Error(detail || "Access denied");
        err.status = res.status;
        throw err;
    }

    if (!res.ok) {
        throw new Error(await res.text());
    }

    return res.json();
}

/**
 * Данные Яндекс.Метрики для дашборда.
 * GET /dashboard/metrika
 *
 * params:
 *  - startDate?: "YYYY-MM-DD"
 *  - endDate?: "YYYY-MM-DD"
 */
export async function fetchDashboardMetrika({ startDate, endDate } = {}) {
    const sp = new URLSearchParams();
    if (startDate) sp.set("start_date", startDate);
    if (endDate) sp.set("end_date", endDate);

    const qs = sp.toString();
    const url = qs ? `/dashboard/metrika?${qs}` : "/dashboard/metrika";

    const res = await http.get(url);

    if (res.status === 401 || res.status === 403) {
        const body = await res.text();
        let detail = body;
        try {
            const json = JSON.parse(body);
            detail = json.detail || body;
        } catch {
            // ignore
        }
        const err = new Error(detail || "Access denied");
        err.status = res.status;
        throw err;
    }

    if (!res.ok) {
        throw new Error(await res.text());
    }

    return res.json();
}
