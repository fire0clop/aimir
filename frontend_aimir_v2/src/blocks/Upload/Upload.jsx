import React, { useEffect, useRef, useState } from "react";
import s from "./Upload.module.css";
import Mascot from "../../components/Mascot";
import { useAuth } from "../../context/AuthContext";
import {
  ensureGuest, uploadUserDocument, uploadGuestDocument,
  claimGuestDocuments, loadGuestToken, clearGuest,
} from "../../api/documents";
import {
  analyzeParties, selectParty, unlockAnalysis,
  sendAnalysisFeedback, applyDocumentEdits,
} from "../../api/analysis";

const METRIKA_ID = 104333423;
function trackGoal(n, p) {
  if (typeof window !== "undefined" && window.ym) window.ym(METRIKA_ID, "reachGoal", n, p);
}

function scoreTone(score) {
  if (score == null) return "low";
  if (score <= 40) return "hi";
  if (score <= 70) return "mid";
  return "ok";
}
function scoreTitle(score) {
  if (score == null) return "";
  if (score <= 25) return "Критически опасный договор";
  if (score <= 40) return "Высокий уровень риска";
  if (score <= 60) return "Умеренный риск — нужна доработка";
  if (score <= 80) return "Небольшие замечания";
  return "Договор в целом безопасен";
}

const SEV_LABEL = { high: "Критично", medium: "Средний", low: "Незначительно" };
const SEV_CLASS = { high: s.sevHi, medium: s.sevMid, low: s.sevLow };
const RISK_CLASS = { high: s.riskHi, medium: s.riskMid, low: s.riskLow };

const DIAL_R = 74;
const DIAL_LEN = 2 * Math.PI * DIAL_R;

// ─── Single issue accordion card ──────────────────────────────
function IssueCard({
  issue, defaultOpen,
  canApply, draft, onDraft, applied, onToggleApplied, applyError,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const showApply = canApply && !!issue.text && !!issue.suggestion;
  return (
    <div className={[s.risk, RISK_CLASS[issue.severity] || s.riskLow, open ? s.riskOpen : ""].join(" ")}>
      <button
        type="button"
        className={s.riskHead}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={[s.sev, SEV_CLASS[issue.severity] || s.sevLow].join(" ")}>
          {SEV_LABEL[issue.severity] || issue.severity}
        </span>
        <h5 className={s.riskProblem}>{issue.problem}</h5>
        {applied && <span className={s.appliedChip}>✓ правка</span>}
        {issue.clause && <span className={s.riskClause}>{issue.clause}</span>}
        <span className={s.riskArrow} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      <div className={s.riskBody}>
        <div className={s.riskBodyInner}>
          {issue.text && (
            <blockquote className={s.quote}>
              «{issue.text}»
              {issue.clause && <span>{issue.clause}</span>}
            </blockquote>
          )}
          {issue.risk && (
            <div className={[s.riskPoint, s.pointWhat].join(" ")}>
              <h6><span className={s.pointDot} />Что может случиться</h6>
              <p>{issue.risk}</p>
            </div>
          )}
          {issue.why && (
            <div className={[s.riskPoint, s.pointWhy].join(" ")}>
              <h6><span className={s.pointDot} />Почему это проблема</h6>
              <p>{issue.why}</p>
            </div>
          )}
          {issue.fix && (
            <div className={[s.riskPoint, s.pointFix].join(" ")}>
              <h6><span className={s.pointDot} />Как исправить</h6>
              <p>{issue.fix}</p>
            </div>
          )}

          {showApply && (
            <div className={[s.riskPoint, s.applyBlock].join(" ")}>
              <h6><span className={s.pointDot} />Новая формулировка — можно отредактировать</h6>
              <textarea
                className={s.applyTextarea}
                value={draft}
                onChange={e => onDraft(e.target.value)}
                disabled={applied}
                rows={Math.min(8, Math.max(3, Math.ceil((draft || "").length / 90)))}
              />
              {applyError && <div className={s.applyError}>Не удалось применить: {applyError}</div>}
              <div className={s.applyActions}>
                <button
                  type="button"
                  className={applied ? [s.btn, s.btnGhost].join(" ") : [s.btn, s.btnPeach].join(" ")}
                  onClick={onToggleApplied}
                >
                  {applied ? "Отменить правку" : "Применить правку"}
                </button>
                {applied && <span className={s.applyDone}>Будет заменено в документе</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────
export default function Upload() {
  const { user } = useAuth();

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const [docId, setDocId] = useState(null);
  const [parties, setParties] = useState([]);
  const [partiesLoading, setPartiesLoading] = useState(false);
  const [selectedParty, setSelectedParty] = useState("");
  const [selectBusy, setSelectBusy] = useState(false);
  const [analysisId, setAnalysisId] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [access, setAccess] = useState(null);
  const [feedbackKind, setFeedbackKind] = useState(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [scoreAnimated, setScoreAnimated] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");

  // правки документа: черновики формулировок, отметки «применить», ошибки
  const [docName, setDocName] = useState("");
  const [drafts, setDrafts] = useState({});
  const [appliedEdits, setAppliedEdits] = useState({});
  const [editErrors, setEditErrors] = useState({});
  const [downloadBusy, setDownloadBusy] = useState(false);

  useEffect(() => { if (!user) ensureGuest().catch(() => {}); }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) return;
      const token = loadGuestToken();
      if (!token) return;
      try {
        const res = await claimGuestDocuments();
        if (!cancelled && res?.moved > 0) clearGuest();
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (analysis) { setTimeout(() => setScoreAnimated(true), 80); }
    else { setScoreAnimated(false); }
  }, [analysis]);

  const resetState = () => {
    setDocId(null); setParties([]); setPartiesLoading(false);
    setSelectedParty(""); setSelectBusy(false); setAnalysisId(null);
    setAnalysis(null); setAccess(null); setFeedbackKind(null);
    setScoreAnimated(false); setActiveFilter("all");
    setDocName(""); setDrafts({}); setAppliedEdits({});
    setEditErrors({}); setDownloadBusy(false);
  };

  const handleFiles = async (files) => {
    if (!files?.length) return;
    const file = files[0];
    try {
      setBusy(true); setErr(""); resetState();
      setDocName(file.name || "");
      let uploadRes;
      if (user) uploadRes = await uploadUserDocument(file);
      else { await ensureGuest(); uploadRes = await uploadGuestDocument(file); }
      const newDocId = uploadRes?.id;
      if (!newDocId) throw new Error("Не получили id документа.");
      setDocId(newDocId);
      trackGoal("upload_doc", { is_auth: !!user });
      setPartiesLoading(true);
      const res = await analyzeParties({ documentId: newDocId, force: true });
      const found = Array.isArray(res?.parties) ? res.parties : [];
      setParties(found);
      if (!found.length) setErr("Стороны не найдены — попробуйте другой документ.");
    } catch (e) { setErr(parseErr(e)); }
    finally { setBusy(false); setPartiesLoading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const onSelectParty = async (party) => {
    if (selectedParty) return;
    setSelectedParty(party);
    trackGoal("select_party", { party, is_auth: !!user });
    setErr(""); setAnalysis(null); setAnalysisId(null); setAccess(null); setFeedbackKind(null);
    if (!docId) { setErr("Сначала загрузите документ."); return; }
    try {
      setSelectBusy(true);
      const res = await selectParty({ documentId: docId, selectedParty: party });
      setAnalysisId(res?.analysis_id || null);
      setAnalysis(res?.analysis || null);
      setAccess(res?.access || null);
      setFeedbackKind(res?.feedback_kind || null);
      // модалку больше не показываем автоматически — используем inline-пейвол
    } catch (e) {
      setErr(parseErr(e));
      // сбрасываем выбор, иначе кнопки сторон останутся заблокированными навсегда
      setSelectedParty("");
    }
    finally { setSelectBusy(false); }
  };

  const onUnlock = async () => {
    if (!analysisId) return;
    try {
      setSelectBusy(true); setErr("");
      const res = await unlockAnalysis(analysisId);
      setAnalysis(res?.analysis || null); setAccess(res?.access || null);
      setAnalysisId(res?.analysis_id || analysisId); setShowPayModal(false);
      setDrafts({}); setAppliedEdits({}); setEditErrors({});
    } catch (e) { setErr(parseErr(e)); }
    finally { setSelectBusy(false); }
  };

  const onFeedback = async (kind) => {
    if (!analysisId || !user || access?.mode !== "full") return;
    try {
      setFeedbackBusy(true);
      const res = await sendAnalysisFeedback({ analysisId, feedbackKind: kind });
      setAnalysis(res?.analysis || analysis); setFeedbackKind(kind);
    } catch (e) { setErr(parseErr(e)); }
    finally { setFeedbackBusy(false); }
  };

  const disabled = busy || partiesLoading || selectBusy;
  const isGuest = !user;
  const mode = access?.mode || (isGuest ? "guest" : null);
  const credits = access?.credits ?? 0;
  const canUnlock = !!access?.can_unlock;
  const showModal = showPayModal && !!analysis && (isGuest || mode === "preview");
  const canFeedback = !!analysis && !!analysisId && !isGuest && mode === "full" && !feedbackKind;

  const dangerScore = analysis?.overall_assessment?.danger_score ?? null;
  const verdict = analysis?.overall_assessment?.verdict ?? "";
  const summary = analysis?.summary ?? "";
  const issues = analysis?.issues ?? [];
  const lockedCount = analysis?.issues_locked_count ?? 0;
  const isLocked = (mode === "guest" || mode === "preview") && (lockedCount > 0 || issues.length === 0);

  // filter tabs
  const highCount = issues.filter(i => i.severity === "high").length;
  const medCount  = issues.filter(i => i.severity === "medium").length;
  const lowCount  = issues.filter(i => i.severity === "low").length;

  const indexedIssues = issues.map((issue, idx) => ({ issue, idx }));
  const filteredIssues = activeFilter === "all" ? indexedIssues
    : indexedIssues.filter(({ issue }) => issue.severity === activeFilter);

  // ── правки документа ──
  const isDocx = /\.docx$/i.test(docName || "");
  const isEditableFormat = /\.(docx|doc|pdf)$/i.test(docName || "");
  const canApplyEdits = mode === "full" && isEditableFormat;
  const draftOf = (idx) => drafts[idx] ?? issues[idx]?.suggestion ?? "";
  const clauseNumOf = (issue) => {
    const m = String(issue?.clause || "").match(/^\[?(\d+(?:\.\d+)*)\]?$/);
    return m ? m[1] : null;
  };
  const appliedIdxList = indexedIssues
    .filter(({ idx }) => appliedEdits[idx])
    .map(({ idx }) => idx);
  const appliedCount = appliedIdxList.length;

  const onDownloadEdited = async () => {
    if (!docId || !appliedCount || downloadBusy) return;
    try {
      setDownloadBusy(true); setErr(""); setEditErrors({});
      const edits = appliedIdxList.map(idx => ({
        old: issues[idx].text,
        new: draftOf(idx),
        clause: clauseNumOf(issues[idx]),
      }));
      const { blob, filename } = await applyDocumentEdits({ documentId: docId, edits });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      trackGoal("download_edited_doc", { edits: appliedCount, is_auth: !!user });
    } catch (e) {
      if (Array.isArray(e?.failed) && e.failed.length) {
        const errs = {};
        e.failed.forEach(f => {
          const issueIdx = appliedIdxList[f.index];
          if (issueIdx != null) errs[issueIdx] = f.reason || "фрагмент не найден";
        });
        setEditErrors(errs);
        setErr("Часть правок не нашлась в документе — они помечены в списке ниже. Отмените их или поправьте формулировку.");
      } else {
        setErr(parseErr(e));
      }
    } finally { setDownloadBusy(false); }
  };

  const tabs = [
    { id: "all",    label: `Все (${issues.length})` },
    ...(highCount > 0 ? [{ id: "high",   label: `Критично (${highCount})` }] : []),
    ...(medCount  > 0 ? [{ id: "medium", label: `Средние (${medCount})` }] : []),
    ...(lowCount  > 0 ? [{ id: "low",    label: `Незначительные (${lowCount})` }] : []),
  ];

  function pluralRisks(n) {
    if (n % 10 === 1 && n % 100 !== 11) return "риск";
    if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return "риска";
    return "рисков";
  }

  // phase
  const phase = !docId ? "upload"
    : selectBusy ? "loading"
    : analysis ? "results"
    : "parties";

  const tone = scoreTone(dangerScore);
  const toneText = { hi: s.toneHi, mid: s.toneMid, ok: s.toneOk, low: "" }[tone];
  const dialStroke = { hi: "#d96b6b", mid: "#dfa14f", ok: "#6fae8f", low: "#8aa0b8" }[tone];

  return (
    <section id="upload" className={s.section}>
      {/* атмосфера: небо, облака, дымка */}
      <div className={s.sky} aria-hidden="true">
        <div className={[s.cloud, s.cloud1].join(" ")} />
        <div className={[s.cloud, s.cloud2].join(" ")} />
        <div className={[s.cloud, s.cloud3].join(" ")} />
        <div className={[s.cloud, s.cloud4].join(" ")} />
      </div>
      <div className={s.fog} aria-hidden="true" />

      <div className={s.wrap}>

        {/* ── Phase 1: Upload ── */}
        {phase === "upload" && (
          <div className={s.heroGrid}>
            <div className={s.heroLeft}>
              <h1 className={s.heroTitle}>
                Проверьте договор <em>до подписания</em>
              </h1>
              <p className={s.heroSub}>
                ИИ найдёт скрытые риски и объяснит их простым языком за 30 секунд.
                Без юридического жаргона — только то, что важно именно вам.
              </p>

              <div
                className={[s.dropzone, dragOver ? s.dropzoneOver : "", disabled ? s.dropzoneDisabled : ""].join(" ")}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                onClick={() => !disabled && fileRef.current?.click()}
                onKeyDown={e => !disabled && (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
                role="button" tabIndex={0} aria-disabled={disabled}
                aria-label="Загрузить договор"
              >
                <div className={s.dzIcon}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 16V4m0 0l-4 4m4-4l4 4" stroke="#e58a60" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="#556174" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <div className={s.dzTitle}>{busy ? "Загружаем…" : "Перетащите договор сюда"}</div>
                <div className={s.dzHint}>или нажмите, чтобы выбрать файл с устройства</div>
                <button
                  className={[s.btn, s.btnPeach].join(" ")}
                  onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
                  disabled={disabled} type="button"
                >
                  Выбрать файл
                </button>
                <div className={s.dzFormats}>
                  <span className={s.dzFormat}>PDF</span>
                  <span className={s.dzFormat}>DOC</span>
                  <span className={s.dzFormat}>DOCX</span>
                </div>
                <input
                  ref={fileRef} type="file" className={s.fileInput} disabled={disabled}
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={e => handleFiles(e.target.files)}
                />
              </div>

              {err && <div className={s.alert}>{err}</div>}

              <div className={s.heroBadges}>
                <span className={s.heroBadge}>Анализ за ~30 секунд</span>
                <span className={s.heroBadge}>Файлы не передаются третьим лицам</span>
                <span className={s.heroBadge}>Первая проверка — бесплатно</span>
              </div>
            </div>

            <div className={s.mascotCol}>
              <Mascot bubble={busy ? "Загружаю…" : "Давайте посмотрим, что там мелким шрифтом 👀"} reading={busy} />
            </div>
          </div>
        )}

        {/* ── Phase 2: Party ── */}
        {phase === "parties" && (
          <div className={s.partyPhase}>
            {partiesLoading ? (
              <PhaseLoader label="Читаем договор и ищем стороны…" />
            ) : (
              <>
                <div className={s.partyHead}>
                  <h2>Кем вы являетесь в этом договоре?</h2>
                  <p>Мы нашли стороны в тексте. От вашего выбора зависит, чьи интересы будет защищать анализ.</p>
                </div>

                {err && <div className={s.alert}>{err}</div>}

                {parties.length === 0 ? (
                  <p className={s.partyEmpty}>Стороны не найдены — попробуйте другой документ.</p>
                ) : (
                  <ul className={s.partyGrid}>
                    {parties.map((p, i) => (
                      <li key={p}>
                        <button
                          className={[s.partyCard, selectedParty === p ? s.partyCardSelected : ""].join(" ")}
                          onClick={() => onSelectParty(p)}
                          disabled={disabled || !!selectedParty}
                          type="button"
                        >
                          <div className={s.partyAvatar}>{(p || "?").trim()[0]?.toUpperCase() || "?"}</div>
                          <span className={s.partyRole}>Сторона {i + 1}</span>
                          <div className={s.partyName}>{p}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Phase 3: Loading ── */}
        {phase === "loading" && (
          <PhaseLoader label="Анализируем договор…" sub="Обычно это занимает около 30 секунд" />
        )}

        {/* ── Phase 4: Results ── */}
        {phase === "results" && analysis && (
          <div className={s.resultsPhase}>

            {err && <div className={s.alert} style={{ marginBottom: 20 }}>{err}</div>}

            {/* Score */}
            {dangerScore != null && (
              <div className={s.scoreCard}>
                <div className={s.scoreDial}>
                  <svg width="172" height="172" viewBox="0 0 172 172">
                    <circle cx="86" cy="86" r={DIAL_R} fill="none" stroke="#e9edf3" strokeWidth="14" />
                    <circle
                      cx="86" cy="86" r={DIAL_R} fill="none"
                      stroke={dialStroke} strokeWidth="14" strokeLinecap="round"
                      strokeDasharray={DIAL_LEN}
                      strokeDashoffset={scoreAnimated ? DIAL_LEN * (1 - dangerScore / 100) : DIAL_LEN}
                      style={{ transition: "stroke-dashoffset 1.2s ease" }}
                      transform="rotate(-90 86 86)"
                    />
                  </svg>
                  <div className={s.scoreNum}>
                    <div>
                      <b className={toneText}>
                        {dangerScore}
                        <small>/100</small>
                      </b>
                      <span>балл безопасности</span>
                    </div>
                  </div>
                </div>
                <div className={s.scoreText}>
                  <h3 className={toneText}>{scoreTitle(dangerScore)}</h3>
                  {verdict && <p>{verdict}</p>}
                  {!isLocked && issues.length > 0 && (
                    <div className={s.scoreChips}>
                      {highCount > 0 && <span className={[s.chip, s.chipHi].join(" ")}>{highCount} критичных</span>}
                      {medCount  > 0 && <span className={[s.chip, s.chipMid].join(" ")}>{medCount} средних</span>}
                      {lowCount  > 0 && <span className={[s.chip, s.chipLow].join(" ")}>{lowCount} незначительных</span>}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Summary */}
            {summary && (
              <div className={s.aboutCard}>
                <h4>О договоре</h4>
                <p>{summary}</p>
              </div>
            )}

            {/* Issues */}
            <div className={s.issuesSection}>
              {isLocked ? (
                /* ── Paywall ───────────────────────────────────── */
                <div className={s.paywall}>
                  <div className={s.paywallCount}>
                    {lockedCount > 0 && <span className={s.paywallNum}>{lockedCount}</span>}
                    <p>
                      {lockedCount > 0
                        ? `${pluralRisks(lockedCount)} найдено в вашем договоре`
                        : "Детальный анализ доступен"}
                      <span>
                        {mode === "guest"
                          ? "Полный разбор каждого риска с цитатами и рекомендациями — после регистрации"
                          : canUnlock
                            ? `Разблокируйте за 1 запрос (у вас ${credits}) — и получите полный разбор`
                            : "Оформите подписку или пополните баланс, чтобы разблокировать детальный анализ"}
                      </span>
                    </p>
                  </div>

                  <div className={s.teasers} aria-hidden="true">
                    {[
                      { cls: s.teaserHi, sev: "Критично", sevCls: s.sevHi },
                      { cls: "", sev: "Средний", sevCls: s.sevMid },
                      { cls: "", sev: "Средний", sevCls: s.sevMid },
                    ].map((t, i) => (
                      <div key={i} className={[s.teaser, t.cls].join(" ")}>
                        <span className={[s.sev, t.sevCls].join(" ")}>{t.sev}</span>
                        <div>
                          <h5>Название риска скрыто до разблокировки</h5>
                          <p>пункт договора · описание риска и рекомендации</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className={s.paywallCta}>
                    {mode === "guest" && (
                      <>
                        <a className={[s.btn, s.btnPeach, s.btnLg].join(" ")} href="/register">Зарегистрироваться бесплатно</a>
                        <p><a className={s.paywallLink} href="/login">Уже есть аккаунт</a> · Полный отчёт — без оплаты и карты</p>
                      </>
                    )}
                    {mode === "preview" && canUnlock && (
                      <button className={[s.btn, s.btnPeach, s.btnLg].join(" ")} onClick={onUnlock} disabled={selectBusy} type="button">
                        {selectBusy ? "Разблокируем…" : "Разблокировать за 1 запрос"}
                      </button>
                    )}
                    {mode === "preview" && (
                      <p><a className={s.paywallLink} href="/billing">Тарифы и подписка</a></p>
                    )}
                  </div>
                </div>
              ) : issues.length > 0 ? (
                /* ── Full issues list ───────────────────────────── */
                <>
                  <div className={s.risksHeadRow}>
                    <h3 className={s.risksTitle}>Найденные риски</h3>
                    {tabs.length > 2 && (
                      <div className={s.filterTabs}>
                        {tabs.map(tab => (
                          <button key={tab.id} type="button"
                            className={[s.filterTab, activeFilter === tab.id ? s.filterTabActive : ""].join(" ")}
                            onClick={() => setActiveFilter(tab.id)}>
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className={s.riskList}>
                    {filteredIssues.map(({ issue, idx }) => (
                      <IssueCard
                        key={`${activeFilter}-${idx}`}
                        issue={issue}
                        defaultOpen={issue.severity === "high"}
                        canApply={canApplyEdits}
                        draft={draftOf(idx)}
                        onDraft={(v) => setDrafts(d => ({ ...d, [idx]: v }))}
                        applied={!!appliedEdits[idx]}
                        onToggleApplied={() => {
                          setAppliedEdits(a => ({ ...a, [idx]: !a[idx] }));
                          setEditErrors(er => { const c = { ...er }; delete c[idx]; return c; });
                        }}
                        applyError={editErrors[idx]}
                      />
                    ))}
                  </div>

                  {canApplyEdits && appliedCount > 0 && (
                    <div className={s.downloadBar}>
                      <div className={s.downloadInfo}>
                        <b>{appliedCount}</b> {appliedCount === 1 ? "правка будет применена"
                          : appliedCount < 5 ? "правки будут применены" : "правок будет применено"} к документу.
                        {isDocx
                          ? " Форматирование сохранится."
                          : " Исправленная версия будет в формате DOCX."}
                      </div>
                      <button
                        type="button"
                        className={[s.btn, s.btnPeach].join(" ")}
                        onClick={onDownloadEdited}
                        disabled={downloadBusy}
                      >
                        {downloadBusy ? "Собираем документ…" : "Скачать исправленный договор"}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* ── No issues ──────────────────────────────────── */
                <div className={s.aboutCard}>
                  <p className={s.noIssues}>
                    🎉 Явных проблемных пунктов не обнаружено. Рекомендуем внимательно ознакомиться со всеми условиями перед подписанием.
                  </p>
                </div>
              )}
            </div>

            {/* Feedback */}
            {canFeedback && (
              <div className={s.feedbackRow}>
                <div className={s.feedbackLabel}>Насколько полезен был анализ?</div>
                <div className={s.feedbackBtns}>
                  {[["clear","Всё понятно"],["inaccurate","Есть неточности"],["not_expected","Не то, что ожидал"]].map(([k,l]) => (
                    <button key={k} className={s.feedbackBtn} onClick={() => onFeedback(k)} disabled={feedbackBusy} type="button">{l}</button>
                  ))}
                </div>
              </div>
            )}
            {feedbackKind && (
              <div className={s.feedbackRow}><p className={s.feedbackDone}>Спасибо за оценку</p></div>
            )}

            <div className={s.restartRow}>
              <button className={[s.btn, s.btnGhost].join(" ")} type="button" onClick={resetState}>
                Проверить другой договор
              </button>
            </div>

          </div>
        )}

      </div>

      <PaywallModal open={showModal} onClose={() => setShowPayModal(false)}
        isGuest={isGuest} mode={mode} credits={credits} canUnlock={canUnlock}
        onUnlock={onUnlock} busy={selectBusy} />
    </section>
  );
}

function PhaseLoader({ label, sub }) {
  return (
    <div className={s.loadingPhase}>
      <Mascot reading size={240} />
      <p className={s.loadingLabel}>{label}</p>
      {sub && <p className={s.loadingSub}>{sub}</p>}
      <div className={s.loadingDots} aria-hidden="true"><span /><span /><span /></div>
    </div>
  );
}

function PaywallModal({ open, onClose, isGuest, mode, credits, canUnlock, onUnlock, busy }) {
  if (!open) return null;
  const isPreview = !isGuest && mode === "preview";
  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <button className={s.modalClose} onClick={onClose} type="button">×</button>
        <div className={s.modalTitle}>{isGuest ? "Зарегистрируйтесь для полного доступа" : "Разблокировать анализ"}</div>
        <p className={s.modalText}>
          {isGuest
            ? "Вы видите сокращённую версию. После регистрации получите полный разбор каждого рискового пункта с рекомендациями."
            : `Разблокируйте полный разбор за 1 запрос${credits > 0 ? ` (у вас ${credits})` : ""} или оформите подписку.`}
        </p>
        <div className={s.modalActions}>
          {isGuest && <><a className={[s.btn, s.btnPeach].join(" ")} href="/register">Зарегистрироваться</a><a className={[s.btn, s.btnGhost].join(" ")} href="/login">Уже есть аккаунт</a></>}
          {isPreview && canUnlock && <button className={[s.btn, s.btnPeach].join(" ")} onClick={onUnlock} disabled={busy} type="button">Разблокировать за 1 запрос</button>}
          {isPreview && <a className={[s.btn, s.btnGhost].join(" ")} href="/billing">Тарифы</a>}
        </div>
      </div>
    </div>
  );
}

function parseErr(e) {
  try {
    const t = e?.message || "";
    if (t.startsWith("{")) return JSON.parse(t).detail || t;
    return t || "Request failed";
  } catch { return "Request failed"; }
}
