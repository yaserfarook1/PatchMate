import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ShieldX, Loader2, CheckCircle2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [status, setStatus] = useState<"loading" | "denied" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [deniedUser, setDeniedUser] = useState<{ name?: string; email?: string }>({});

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");

    if (error) {
      setStatus("error");
      setErrorMsg(params.get("error_description") ?? error);
      return;
    }

    if (!code || !state) {
      setStatus("error");
      setErrorMsg("Missing authentication parameters");
      return;
    }

    // Exchange code for PatchMate token
    api.post("/auth/microsoft-callback", { code, state })
      .then(({ data }) => {
        localStorage.setItem("autopack_token", data.token);
        localStorage.setItem("autopack_mock_role", data.user.role);
        window.location.href = "/dashboard";
      })
      .catch((err) => {
        const resp = err.response?.data;
        if (resp?.code === "ACCESS_DENIED") {
          setStatus("denied");
          setDeniedUser({ name: resp.name, email: resp.email });
          setErrorMsg(resp.message);
        } else {
          setStatus("error");
          setErrorMsg(resp?.message ?? "Authentication failed");
        }
      });
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        {status === "loading" && (
          <div className="space-y-4">
            <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto" />
            <p className="text-text-muted">Signing you in...</p>
          </div>
        )}

        {status === "denied" && (
          <div className="space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
              <ShieldX className="w-8 h-8 text-red-400" />
            </div>
            <h1 className="text-xl font-bold text-text">Access Denied</h1>
            {deniedUser.name && (
              <p className="text-text-muted text-sm">
                Hi <strong className="text-text">{deniedUser.name}</strong> ({deniedUser.email})
              </p>
            )}
            <p className="text-text-muted text-sm">{errorMsg}</p>
            <div className="bg-surface border border-border rounded-lg p-4 text-xs text-text-muted text-left space-y-2 mt-4">
              <p className="font-medium text-text">What to do:</p>
              <p>Ask your PatchMate administrator to grant you access from:</p>
              <p className="font-mono text-primary">Settings → Access Management</p>
            </div>
            <button
              onClick={() => navigate("/login")}
              className="mt-4 px-4 py-2 text-sm bg-surface border border-border rounded-lg text-text-muted hover:text-text transition-colors"
            >
              Back to login
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
              <ShieldX className="w-8 h-8 text-red-400" />
            </div>
            <h1 className="text-xl font-bold text-text">Sign-in Failed</h1>
            <p className="text-text-muted text-sm">{errorMsg}</p>
            <button
              onClick={() => navigate("/login")}
              className="mt-4 px-4 py-2 text-sm bg-surface border border-border rounded-lg text-text-muted hover:text-text"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
