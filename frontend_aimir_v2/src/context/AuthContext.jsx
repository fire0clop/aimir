// src/context/AuthContext.jsx
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { http } from "../api/http";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);   // загрузка auth-состояния

    const fetchMe = useCallback(async () => {
        const res = await http.get("/users/me");
        if (res.ok) return res.json();
        throw new Error(await res.text());
    }, []);

    const refreshUser = useCallback(async () => {
        try {
            setLoading(true);
            // если нет access — попробуем загрузить из localStorage
            http.loadTokens();

            // если токена нет вообще — выходим в гостя
            if (!http.getTokens()?.access_token) {
                setUser(null);
                return null;
            }

            // http.js сам рефрешит токены при 401 и чистит их,
            // только если сервер явно отклонил refresh
            const me = await fetchMe();
            setUser(me);
            return me;
        } catch {
            // сюда попадаем и при сетевом сбое — токены НЕ трогаем,
            // чтобы моргнувший интернет не разлогинивал пользователя
            setUser(null);
            return null;
        } finally {
            setLoading(false);
        }
    }, [fetchMe]);

    const logout = useCallback(() => {
        http.clearTokens();
        setUser(null);
    }, []);

    useEffect(() => {
        // инициализация при загрузке приложения
        refreshUser();
    }, [refreshUser]);

    const value = {
        user,
        loading,
        isAuthed: !!user,
        setUser,
        refreshUser,
        logout,
    };

    return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
    return useContext(AuthCtx);
}
