import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import "./styles.css";

import { AuthProvider, useAuth } from "./context/AuthContext";
import Header from "./context/Header";
import Footer from "./context/Footer";

import Home from "./pages/Home";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Billing from "./pages/Billing";
import Documents from "./pages/Documents";
import Dashboard from "./pages/Dashboard";

/** Политики */
import UserAgreement from "./pages/politics/UserAgreement";
import PrivacyPolicy from "./pages/politics/PrivacyPolicy";
import Offer from "./pages/politics/Offer";

/** Закрывает маршрут: пускает только авторизованных */
function RequireAuth({ children }) {
    const { user, loading } = useAuth();
    if (loading) return null;
    if (!user) return <Navigate to="/login" replace />;
    return children;
}

/** Страницы только для гостей (login/register). Если авторизован — в профиль */
function PublicOnly({ children }) {
    const { user, loading } = useAuth();
    if (loading) return null;
    if (user) return <Navigate to="/billing" replace />;
    return children;
}

/** Общая «оболочка» страницы: показывает Header/Footer кроме страниц аутентификации */
function Shell({ children }) {
    const { pathname } = useLocation();
    const hideChrome = pathname.startsWith("/login") || pathname.startsWith("/register");

    return (
        <>
            {!hideChrome && <Header />}
            {children}
            {!hideChrome && <Footer />}
        </>
    );
}

function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <Shell>
                    <Routes>
                        {/* Главная всегда доступна */}
                        <Route path="/" element={<Home />} />
                        <Route path="/UserAgreement" element={<UserAgreement />} />
                        <Route path="/PrivacyPolicy" element={<PrivacyPolicy />} />
                        <Route path="/Offer" element={<Offer />} />

                        {/* Только для гостей */}
                        <Route
                            path="/login"
                            element={
                                <PublicOnly>
                                    <Login />
                                </PublicOnly>
                            }
                        />
                        <Route
                            path="/register"
                            element={
                                <PublicOnly>
                                    <Register />
                                </PublicOnly>
                            }
                        />

                        {/* Приватные */}

                        <Route
                            path="/billing"
                            element={
                                <RequireAuth>
                                    <Billing />
                                </RequireAuth>
                            }
                        />
                        <Route
                            path="/documents"
                            element={
                                <RequireAuth>
                                    <Documents />
                                </RequireAuth>
                            }
                        />
                        <Route
                            path="/dashboard"
                            element={
                                <RequireAuth>
                                    <Dashboard />
                                </RequireAuth>
                            }
                        />

                        {/* Остальное — на главную */}
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </Shell>
            </AuthProvider>
        </BrowserRouter>
    );
}

createRoot(document.getElementById("root")).render(<App />);
