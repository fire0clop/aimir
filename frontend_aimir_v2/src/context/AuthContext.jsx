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

    const refreshTokens = useCallback(async () => {
        const tk = http.getTokens();
        if (!tk?.refresh_token) throw new Error("no-refresh");
        const r = await http.post("/users/refresh", { refresh_token: tk.refresh_token });
        if (!r.ok) throw new Error(await r.text());
        const newTokens = await r.json();
        http.setTokens(newTokens);
        return newTokens;
    }, []);

    const refreshUser = useCallback(async () => {
        try {
            setLoading(true);
            // если нет access — попробуем загрузить из localStorage
            http.loadTokens();

            // если токена нет вообще — выходим в гостя
            if (!http.getTokens()?.access_token) {
                setUser(null);
                setLoading(false);
                return null;
            }

            try {
                const me = await fetchMe();
                setUser(me);
                return me;
            } catch {
                // попробовать рефреш и ещё раз me
                await refreshTokens();
                const me2 = await fetchMe();
                setUser(me2);
                return me2;
            }
        } catch {
            http.clearTokens();
            setUser(null);
            return null;
        } finally {
            setLoading(false);
        }
    }, [fetchMe, refreshTokens]);

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
