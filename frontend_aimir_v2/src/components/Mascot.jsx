import React, { useEffect, useRef, useState } from "react";
import s from "./Mascot.module.css";

/**
 * Маскот AiMIR — робот в сером вязаном худи.
 *
 * Анимации:
 *  - многослойное парение: вертикаль + покачивание с разными периодами + сквош в нижней точке
 *  - глаза следят за курсором; без курсора — сами «осматриваются»
 *  - голова слегка доворачивается за взглядом
 *  - руки и шнурки покачиваются с собственной инерцией
 *  - моргание (иногда двойное), пульс свечения глаз
 *  - reading: глаза «сканируют строки», свечение пульсирует чаще
 *  - клик: подпрыгивает и радуется (глаза-дуги)
 *
 * props:
 *  - bubble: текст реплики в облачке (null — без облачка)
 *  - reading: режим «читает договор»
 *  - size: максимальная ширина svg в px (по умолчанию 320)
 */
export default function Mascot({ bubble, reading = false, size = 320 }) {
    const stageRef = useRef(null);
    const headRef = useRef(null);
    const eyesRef = useRef(null);
    const [excited, setExcited] = useState(false);
    const excitedTimer = useRef(null);

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) return;

        // текущее и целевое положение взгляда (в px viewBox)
        const gaze = { x: 0, y: 0 };
        const target = { x: 0, y: 0 };
        let lastMouse = 0;
        let idleTimer = 0;
        let raf;

        const onMove = (e) => {
            lastMouse = performance.now();
            const r = stage.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height * 0.32; // уровень глаз
            // нормируем к [-1..1] по расстоянию до половины экрана
            const nx = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth / 2)));
            const ny = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight / 2)));
            target.x = nx * 8;
            target.y = ny * 5;
        };

        const pickIdleTarget = () => {
            // случайный «взгляд в сторону» или в центр
            if (Math.random() < 0.35) { target.x = 0; target.y = 0; }
            else {
                target.x = (Math.random() * 2 - 1) * 8;
                target.y = (Math.random() * 2 - 1) * 4;
            }
            idleTimer = performance.now() + 1400 + Math.random() * 2200;
        };

        const tick = () => {
            const now = performance.now();
            // мышь молчит 3с — включаем самостоятельное «осматривание»
            if (now - lastMouse > 3000 && now > idleTimer) pickIdleTarget();

            gaze.x += (target.x - gaze.x) * 0.08;
            gaze.y += (target.y - gaze.y) * 0.08;

            if (eyesRef.current) {
                eyesRef.current.setAttribute("transform", `translate(${gaze.x.toFixed(2)} ${gaze.y.toFixed(2)})`);
            }
            if (headRef.current) {
                const ang = gaze.x * 0.35; // лёгкий доворот головы за взглядом
                headRef.current.setAttribute("transform", `rotate(${ang.toFixed(2)} 190 210)`);
            }
            raf = requestAnimationFrame(tick);
        };

        window.addEventListener("mousemove", onMove);
        pickIdleTarget();
        raf = requestAnimationFrame(tick);
        return () => {
            window.removeEventListener("mousemove", onMove);
            cancelAnimationFrame(raf);
        };
    }, []);

    useEffect(() => () => clearTimeout(excitedTimer.current), []);

    const onPoke = () => {
        setExcited(true);
        clearTimeout(excitedTimer.current);
        excitedTimer.current = setTimeout(() => setExcited(false), 1100);
    };

    return (
        <div
            ref={stageRef}
            className={[s.stage, reading ? s.reading : "", excited ? s.excited : ""].join(" ")}
            onClick={onPoke}
            role="presentation"
        >
            {bubble && <div className={s.bubble}>{bubble}</div>}
            <div className={s.shadow} />
            <div className={s.floatY}>
                <div className={s.sway}>
                    <svg
                        className={s.mascot}
                        style={{ width: `min(${size}px, 78%)` }}
                        viewBox="0 0 380 540"
                        xmlns="http://www.w3.org/2000/svg"
                        role="img"
                        aria-label="Маскот AiMIR — робот в сером вязаном худи"
                    >
                        <defs>
                            <linearGradient id="mHoodie" x1="0" y1="0" x2="0.4" y2="1">
                                <stop offset="0" stopColor="#f0f2f6" />
                                <stop offset=".55" stopColor="#d7dce4" />
                                <stop offset="1" stopColor="#b8c0cd" />
                            </linearGradient>
                            <linearGradient id="mHoodieDark" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0" stopColor="#dde2e9" />
                                <stop offset="1" stopColor="#aab3c2" />
                            </linearGradient>
                            <radialGradient id="mHoodInner" cx=".5" cy=".35" r=".8">
                                <stop offset="0" stopColor="#9aa4b4" />
                                <stop offset="1" stopColor="#6f7a8c" />
                            </radialGradient>
                            <radialGradient id="mFace" cx=".38" cy=".3" r="1">
                                <stop offset="0" stopColor="#3b4150" />
                                <stop offset=".55" stopColor="#232833" />
                                <stop offset="1" stopColor="#14171f" />
                            </radialGradient>
                            <linearGradient id="mFaceGloss" x1="0" y1="0" x2="0.6" y2="1">
                                <stop offset="0" stopColor="#ffffff" stopOpacity=".28" />
                                <stop offset=".5" stopColor="#ffffff" stopOpacity=".04" />
                                <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
                            </linearGradient>
                            <linearGradient id="mEye" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0" stopColor="#ffffff" />
                                <stop offset="1" stopColor="#ffd3c9" />
                            </linearGradient>
                            <linearGradient id="mDark" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0" stopColor="#3a3f4b" />
                                <stop offset="1" stopColor="#1c2029" />
                            </linearGradient>
                            <linearGradient id="mPants" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0" stopColor="#333846" />
                                <stop offset="1" stopColor="#20242f" />
                            </linearGradient>
                            <linearGradient id="mShoe" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0" stopColor="#ffffff" />
                                <stop offset="1" stopColor="#e9ecf1" />
                            </linearGradient>
                            <linearGradient id="mPeach" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0" stopColor="#f7b48f" />
                                <stop offset="1" stopColor="#e58a60" />
                            </linearGradient>
                            <filter id="mSoftGlow" x="-80%" y="-80%" width="260%" height="260%">
                                <feGaussianBlur stdDeviation="7" result="b" />
                                <feMerge>
                                    <feMergeNode in="b" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                            <filter id="mBigGlow" x="-120%" y="-120%" width="340%" height="340%">
                                <feGaussianBlur stdDeviation="14" />
                            </filter>
                        </defs>

                        {/* ноги / штаны (покачиваются чуть заметно, в противофазе телу) */}
                        <g className={s.legs}>
                            <path d="M150 356 q-4 46 -2 84 q0 12 13 12 h18 q12 0 12 -12 l4 -82 z" fill="url(#mPants)" />
                            <path d="M230 356 q4 46 2 84 q0 12 -13 12 h-18 q-12 0 -12 -12 l-4 -82 z" fill="url(#mPants)" />
                            <path d="M152 372 q20 8 76 0 l1 -16 h-78 z" fill="#171a22" opacity=".5" />

                            {/* кеды */}
                            <g>
                                <path d="M136 446 q-14 22 -4 32 q6 6 34 6 q26 0 28 -10 l1 -26 q-30 -10 -59 -2 z" fill="url(#mShoe)" />
                                <path d="M132 470 q-2 10 6 12 q10 3 28 2 q24 -1 28 -6 l1 -9 q-32 8 -63 1 z" fill="url(#mPeach)" />
                                <ellipse cx="166" cy="452" rx="17" ry="9" fill="#fff" />
                                <path d="M152 452 l26 -4 M153 458 l26 -4" stroke="#f0a67f" strokeWidth="3" strokeLinecap="round" fill="none" />
                            </g>
                            <g>
                                <path d="M244 446 q14 22 4 32 q-6 6 -34 6 q-26 0 -28 -10 l-1 -26 q30 -10 59 -2 z" fill="url(#mShoe)" />
                                <path d="M248 470 q2 10 -6 12 q-10 3 -28 2 q-24 -1 -28 -6 l-1 -9 q32 8 63 1 z" fill="url(#mPeach)" />
                                <ellipse cx="214" cy="452" rx="17" ry="9" fill="#fff" />
                                <path d="M228 452 l-26 -4 M227 458 l-26 -4" stroke="#f0a67f" strokeWidth="3" strokeLinecap="round" fill="none" />
                            </g>
                        </g>

                        {/* туловище (худи) */}
                        <path
                            d="M128 250 q-10 60 -6 100 q2 20 24 22 q44 5 88 0 q22 -2 24 -22 q4 -40 -6 -100 q-6 -34 -62 -34 q-56 0 -62 34 z"
                            fill="url(#mHoodie)"
                        />
                        <g stroke="#8d97a8" strokeWidth="1.4" opacity=".28" fill="none">
                            <path d="M148 244 q-8 60 -6 118" />
                            <path d="M166 236 q-6 66 -5 132" />
                            <path d="M190 233 q-1 68 0 138" />
                            <path d="M214 236 q6 66 5 132" />
                            <path d="M232 244 q8 60 6 118" />
                        </g>
                        {/* кенгуру-карман */}
                        <path
                            d="M156 306 q34 -10 68 0 q6 2 5 10 l-3 30 q-1 8 -9 9 q-27 4 -54 0 q-8 -1 -9 -9 l-3 -30 q-1 -8 5 -10 z"
                            fill="url(#mHoodieDark)"
                            stroke="#9aa4b4"
                            strokeWidth="1.5"
                            opacity=".95"
                        />
                        {/* нижняя резинка */}
                        <path d="M124 344 q66 14 132 0 l1 14 q-67 15 -134 0 z" fill="url(#mHoodieDark)" />
                        <g stroke="#8d97a8" strokeWidth="1.3" opacity=".4">
                            <path d="M136 348 l-1 12" />
                            <path d="M152 351 l-1 12" />
                            <path d="M168 353 l0 12" />
                            <path d="M190 354 l0 12" />
                            <path d="M212 353 l0 12" />
                            <path d="M228 351 l1 12" />
                            <path d="M244 348 l1 12" />
                        </g>

                        {/* левая рука: рукав + манжета + кисть */}
                        <g className={s.armL}>
                            <path d="M132 250 q-26 10 -30 58 q-2 26 4 44 q4 12 17 10 q12 -2 13 -14 q2 -34 8 -60 q4 -22 -12 -38 z" fill="url(#mHoodieDark)" />
                            <path d="M104 348 q14 8 32 2 l1 12 q-18 7 -34 -2 z" fill="#b0b9c7" />
                            <path d="M107 360 q-12 4 -12 18 q0 16 15 18 q16 2 22 -8 q5 -9 -1 -18 q-8 -12 -24 -10 z" fill="url(#mDark)" />
                            <path d="M100 372 h34" stroke="#0e1117" strokeWidth="2" opacity=".55" />
                            <circle cx="112" cy="381" r="3.4" fill="#565d6b" />
                        </g>
                        {/* правая рука */}
                        <g className={s.armR}>
                            <path d="M248 250 q26 10 30 58 q2 26 -4 44 q-4 12 -17 10 q-12 -2 -13 -14 q-2 -34 -8 -60 q-4 -22 12 -38 z" fill="url(#mHoodieDark)" />
                            <path d="M276 348 q-14 8 -32 2 l-1 12 q18 7 34 -2 z" fill="#b0b9c7" />
                            <path d="M273 360 q12 4 12 18 q0 16 -15 18 q-16 2 -22 -8 q-5 -9 1 -18 q8 -12 24 -10 z" fill="url(#mDark)" />
                            <path d="M280 372 h-34" stroke="#0e1117" strokeWidth="2" opacity=".55" />
                            <circle cx="268" cy="381" r="3.4" fill="#565d6b" />
                        </g>

                        {/* голова: доворачивается за взглядом (transform ставит JS) */}
                        <g ref={headRef}>
                            {/* капюшон */}
                            <path
                                d="M190 44 q-74 0 -88 74 q-6 34 6 62 q10 24 34 30 q48 12 96 0 q24 -6 34 -30 q12 -28 6 -62 q-14 -74 -88 -74 z"
                                fill="url(#mHoodie)"
                            />
                            <path
                                d="M112 176 q10 26 34 32 q44 11 88 0 q24 -6 34 -32 q-6 30 -30 40 q-48 16 -96 0 q-24 -10 -30 -40 z"
                                fill="#96a0b0"
                                opacity=".5"
                            />
                            <g stroke="#8d97a8" strokeWidth="1.5" opacity=".3" fill="none">
                                <path d="M120 96 q70 -34 140 0" />
                                <path d="M110 124 q80 -38 160 0" />
                                <path d="M106 154 q84 -40 168 0" />
                            </g>
                            <path d="M136 66 q52 -30 108 0 q-20 -22 -54 -22 q-34 0 -54 22 z" fill="#ffffff" opacity=".5" />

                            {/* внутренний край капюшона + лицо */}
                            <ellipse cx="190" cy="150" rx="72" ry="80" fill="url(#mHoodInner)" />
                            <ellipse cx="190" cy="151" rx="63" ry="71" fill="url(#mFace)" />
                            <ellipse cx="190" cy="151" rx="63" ry="71" fill="none" stroke="#0d1016" strokeWidth="2" opacity=".55" />
                            <path d="M143 108 q22 -26 55 -22 q26 3 40 22 q-30 -12 -52 -8 q-26 4 -43 8 z" fill="url(#mFaceGloss)" />
                            <ellipse cx="158" cy="112" rx="26" ry="14" fill="#ffffff" opacity=".14" transform="rotate(-18 158 112)" />

                            {/* глаза: слежение (JS) → сканирование (reading) → моргание */}
                            <g ref={eyesRef}>
                                <g className={s.eyesScan}>
                                    <g className={s.eyesGlow} filter="url(#mBigGlow)">
                                        <rect x="153" y="128" width="30" height="44" rx="14" fill="#ffc9be" />
                                        <rect x="197" y="128" width="30" height="44" rx="14" fill="#ffc9be" />
                                    </g>
                                    <g className={[s.eyesBlink, s.eyesOpen].join(" ")} filter="url(#mSoftGlow)">
                                        <rect x="155" y="130" width="26" height="42" rx="12" fill="url(#mEye)" />
                                        <rect x="199" y="130" width="26" height="42" rx="12" fill="url(#mEye)" />
                                    </g>
                                    {/* счастливые глаза-дуги (по клику) */}
                                    <g className={s.eyesHappy} filter="url(#mSoftGlow)">
                                        <path d="M155 158 q13 -20 26 0" stroke="url(#mEye)" strokeWidth="9" strokeLinecap="round" fill="none" />
                                        <path d="M199 158 q13 -20 26 0" stroke="url(#mEye)" strokeWidth="9" strokeLinecap="round" fill="none" />
                                    </g>
                                </g>
                            </g>
                        </g>

                        {/* шнурки: покачиваются с инерцией */}
                        <g className={s.strings}>
                            <g stroke="url(#mPeach)" strokeWidth="6" strokeLinecap="round" fill="none">
                                <path d="M168 224 q-4 20 2 38" />
                                <path d="M212 224 q4 20 -2 38" />
                            </g>
                            <circle cx="170" cy="266" r="6" fill="url(#mPeach)" />
                            <circle cx="210" cy="266" r="6" fill="url(#mPeach)" />
                        </g>
                    </svg>
                </div>
            </div>
        </div>
    );
}
