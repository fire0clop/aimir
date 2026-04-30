// src/api/analysis.js
import { http } from "./http";

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

/**
 * 5) Вспомогательная функция для получения severity в читаемом виде
 *
 * @param {string} severity - "low", "medium", "high"
 * @returns {{ label: string, color: string }}
 */
export function getSeverityInfo(severity) {
    switch (severity) {
        case "high":
            return { label: "Высокий", color: "#dc2626" };
        case "medium":
            return { label: "Средний", color: "#f59e0b" };
        case "low":
            return { label: "Низкий", color: "#10b981" };
        default:
            return { label: "Неизвестно", color: "#6b7280" };
    }
}

/**
 * 6) Вспомогательная функция для получения цвета danger_score
 *
 * @param {number} score - от 0 до 100
 * @returns {string} цвет в HEX
 */
export function getDangerScoreColor(score) {
    if (score >= 70) return "#10b981"; // зелёный - безопасно
    if (score >= 40) return "#f59e0b"; // оранжевый - средний риск
    return "#dc2626"; // красный - высокий риск
}

/**
 * 7) Вспомогательная функция для получения текстовой оценки danger_score
 *
 * @param {number} score - от 0 до 100
 * @returns {string} текстовая оценка
 */
export function getDangerScoreText(score) {
    if (score >= 70) return "Низкий риск";
    if (score >= 40) return "Средний риск";
    return "Высокий риск";
}