// src/api/analysis.js
import { http } from "./http";
import { loadGuestToken } from "./documents";

/**
 * Применить правки к документу и получить исправленный .docx.
 *
 * POST /analysis/apply-edits
 * body: { document_id, edits: [{ old, new, clause? }] }
 *
 * При успехе возвращает { blob, filename }.
 * Если часть правок не нашлась в документе — бросает ошибку с полем
 * failed: [{ index, reason }] (индексы в переданном массиве edits).
 */
export async function applyDocumentEdits({ documentId, edits }) {
    if (!documentId) throw new Error("documentId required");
    if (!edits?.length) throw new Error("edits required");

    const headers = { "Content-Type": "application/json" };
    const tokens = http.getTokens?.();
    if (tokens?.access_token) headers.Authorization = `Bearer ${tokens.access_token}`;
    const guest = loadGuestToken();
    if (guest) headers["X-Guest-Token"] = guest;

    const res = await fetch(http.baseURL + "/analysis/apply-edits", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ document_id: documentId, edits }),
    });

    if (!res.ok) {
        let detail = null;
        try { detail = (await res.json())?.detail; } catch {}
        const err = new Error(
            typeof detail === "string" ? detail : "Не удалось применить правки"
        );
        if (detail && typeof detail === "object" && Array.isArray(detail.failed)) {
            err.failed = detail.failed;
        }
        throw err;
    }

    const blob = await res.blob();
    let filename = "Исправленный договор.docx";
    const cd = res.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename\*=UTF-8''([^;]+)/);
    if (m) { try { filename = decodeURIComponent(m[1]); } catch {} }
    return { blob, filename };
}

/**
 * 1) Найти стороны договора по тексту документа (гость или пользователь).
 *
 * GET /analysis/parties?document_id=...&force=1
 *
 * @param {object} params
 * @param {string} params.documentId - UUID документа
 * @param {boolean} [params.force=true]
 * @returns {Promise<{ parties: string[] }>}
 */
export async function analyzeParties({ documentId, force = true }) {
    if (!documentId) {
        throw new Error("documentId required");
    }

    const qs = new URLSearchParams({
        document_id: documentId,
        ...(force ? { force: "1" } : {}),
    }).toString();

    const res = await http.get(`/analysis/parties?${qs}`);
    if (!res.ok) {
        throw new Error(await res.text());
    }
    return res.json(); // { parties: [...] }
}

/**
 * 2) Запустить полную аналитику по выбранной стороне (новая структура).
 *
 * POST /analysis/select
 *
 * Новая структура ответа:
 * {
 *   analysis_id: string | null,
 *   document_id: string,
 *   selected_party: string,
 *   status: string,
 *   analysis: {
 *     summary: string,
 *     overall_assessment: {
 *       verdict: string,
 *       danger_score: number
 *     },
 *     issues: Array<{
 *       clause: string,
 *       text: string,
 *       problem: string,
 *       risk: string,
 *       why: string,
 *       fix: string,
 *       severity: "low" | "medium" | "high"
 *     }>
 *   },
 *   access: {
 *     mode: "guest" | "preview" | "full",
 *     has_subscription: boolean,
 *     credits: number,
 *     can_unlock: boolean
 *   }
 * }
 *
 * @param {object} params
 * @param {string} params.documentId - UUID документа
 * @param {string} params.selectedParty - выбранная сторона
 * @returns {Promise<{
 *   analysis_id: string | null,
 *   document_id: string,
 *   selected_party: string,
 *   status: string,
 *   analysis: {
 *     summary: string,
 *     overall_assessment: {
 *       verdict: string,
 *       danger_score: number
 *     },
 *     issues: Array<{
 *       clause: string,
 *       text: string,
 *       problem: string,
 *       risk: string,
 *       why: string,
 *       fix: string,
 *       severity: "low" | "medium" | "high"
 *     }>
 *   },
 *   access: {
 *     mode: "guest" | "preview" | "full",
 *     has_subscription: boolean,
 *     credits: number,
 *     can_unlock: boolean
 *   }
 * }>}
 */
export async function selectParty({ documentId, selectedParty }) {
    if (!documentId) {
        throw new Error("documentId required");
    }
    if (!selectedParty) {
        throw new Error("selectedParty required");
    }

    const body = {
        document_id: documentId,
        selected_party: selectedParty,
    };

    const res = await http.post("/analysis/select-v2", body);
    if (!res.ok) {
        throw new Error(await res.text());
    }
    return res.json();
}

/**
 * 3) Разблокировать уже посчитанную аналитику
 *
 * POST /analysis/unlock/{analysis_id}
 *
 * Требует авторизации. При успехе возвращает тот же формат, что и selectParty,
 * но всегда с полным analysis и access.mode = "full".
 *
 * @param {string} analysisId
 * @returns {Promise<{
 *   analysis_id: string,
 *   document_id: string,
 *   selected_party: string,
 *   status: string,
 *   analysis: {
 *     summary: string,
 *     overall_assessment: {
 *       verdict: string,
 *       danger_score: number
 *     },
 *     issues: Array<{
 *       clause: string,
 *       text: string,
 *       problem: string,
 *       risk: string,
 *       why: string,
 *       fix: string,
 *       severity: "low" | "medium" | "high"
 *     }>
 *   },
 *   access: {
 *     mode: "guest" | "preview" | "full",
 *     has_subscription: boolean,
 *     credits: number,
 *     can_unlock: boolean
 *   }
 * }>}
 */
export async function unlockAnalysis(analysisId) {
    if (!analysisId) {
        throw new Error("analysisId required");
    }

    const res = await http.post(`/analysis/unlock-v2/${analysisId}`, {});
    if (!res.ok) {
        throw new Error(await res.text());
    }
    return res.json();
}

/**
 * 4) Отправить фидбек по аналитике
 *
 * POST /analysis/{analysis_id}/feedback
 *
 * Требует авторизации. При успехе возвращает тот же формат,
 * что и selectParty / unlockAnalysis.
 *
 * @param {object} params
 * @param {string} params.analysisId - UUID записи ContractAnalysis
 * @param {"clear" | "inaccurate" | "not_expected"} params.feedbackKind
 * @returns {Promise<{
 *   analysis_id: string,
 *   document_id: string,
 *   selected_party: string,
 *   status: string,
 *   analysis: {
 *     summary: string,
 *     overall_assessment: {
 *       verdict: string,
 *       danger_score: number
 *     },
 *     issues: Array<{
 *       clause: string,
 *       text: string,
 *       problem: string,
 *       risk: string,
 *       why: string,
 *       fix: string,
 *       severity: "low" | "medium" | "high"
 *     }>
 *   },
 *   access: {
 *     mode: "guest" | "preview" | "full",
 *     has_subscription: boolean,
 *     credits: number,
 *     can_unlock: boolean
 *   }
 * }>}
 */
export async function sendAnalysisFeedback({ analysisId, feedbackKind }) {
    if (!analysisId) {
        throw new Error("analysisId required");
    }
    if (!feedbackKind) {
        throw new Error("feedbackKind required");
    }

    const body = { feedback_kind: feedbackKind };

    const res = await http.post(`/analysis/${analysisId}/feedback`, body);
    if (!res.ok) {
        throw new Error(await res.text());
    }
    return res.json();
}
