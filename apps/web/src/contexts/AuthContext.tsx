import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { api } from "../lib/api";

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId?: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  isLoading: true,
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem("autopack_token"));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem("autopack_token");
    if (storedToken) {
      api
        .get("/auth/me")
        .then((r) => setUser(r.data))
        .catch(() => {
          localStorage.removeItem("autopack_token");
          setToken(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  function logout() {
    api.post("/auth/logout").catch(() => {});
    localStorage.removeItem("autopack_token");
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, isLoading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
