import React, { useState } from "react";
import { Navigate } from "react-router-dom";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";

export function LoginPage() {
  const { user, isLoading } = useAuth();
  const [signingIn, setSigningIn] = useState(false);

  if (!isLoading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleMicrosoftLogin() {
    setSigningIn(true);
    try {
      const { data } = await api.get("/auth/microsoft");
      window.location.href = data.authUrl;
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? "Failed to initiate sign-in");
      setSigningIn(false);
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
            Only users granted access by an administrator can sign in.
          </p>
        </div>
      </div>
    </div>
  );
}
