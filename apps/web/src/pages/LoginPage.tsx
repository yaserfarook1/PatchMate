import React, { useState } from "react";
import { Navigate } from "react-router-dom";
import { Zap, LogIn, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";

export function LoginPage() {
  const { user, login, isLoading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [showDevBypass, setShowDevBypass] = useState(false);
  const [devEmail, setDevEmail] = useState("admin@patchmate.dev");

  if (!isLoading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleMicrosoftLogin() {
    setSigningIn(true);
    try {
      const { data } = await api.get("/auth/microsoft");
      // Redirect to Microsoft OAuth
      window.location.href = data.authUrl;
    } catch (err: any) {
      const msg = err.response?.data?.message ?? "Failed to initiate sign-in";
      toast.error(msg);
      setSigningIn(false);
    }
  }

  async function handleDevLogin(e: React.FormEvent) {
    e.preventDefault();
    try {
      await login(devEmail, "Admin");
      toast.success("Signed in (dev bypass)");
    } catch {
      toast.error("Sign in failed");
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-primary mb-4">
            <Zap className="w-7 h-7 text-black" />
          </div>
          <h1 className="text-2xl font-bold text-primary tracking-tight">PatchMate</h1>
          <p className="text-text-muted mt-1 text-sm">Intune App Packaging Platform</p>
        </div>

        <div className="bg-surface border border-border rounded-xl p-6 space-y-5">
          {/* Primary: Microsoft sign-in */}
          <button
            onClick={handleMicrosoftLogin}
            disabled={signingIn}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-black font-medium py-3 rounded-lg transition-colors disabled:opacity-60"
          >
            {signingIn ? (
              <div className="w-4 h-4 border-2 border-gray-400 border-t-black rounded-full animate-spin" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 21 21">
                <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
              </svg>
            )}
            Sign in with Microsoft
          </button>

          <p className="text-xs text-text-muted text-center">
            Only users granted access by an admin can sign in.
          </p>

          {/* Dev bypass (only visible when clicked) */}
          <div className="border-t border-border pt-4">
            {!showDevBypass ? (
              <button
                onClick={() => setShowDevBypass(true)}
                className="w-full text-xs text-text-muted hover:text-text transition-colors"
              >
                Developer bypass
              </button>
            ) : (
              <form onSubmit={handleDevLogin} className="space-y-3">
                <input
                  type="email"
                  value={devEmail}
                  onChange={(e) => setDevEmail(e.target.value)}
                  placeholder="admin@patchmate.dev"
                  className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <button
                  type="submit"
                  className="w-full py-2 text-xs bg-surface-2 hover:bg-border text-text-muted hover:text-text rounded-lg transition-colors"
                >
                  Dev login
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
