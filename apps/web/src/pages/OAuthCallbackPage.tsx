import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useTenant } from "../contexts/TenantContext";
import { useQueryClient } from "@tanstack/react-query";

export function OAuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setActiveTenantId } = useTenant();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const connectedId = params.get("connected");
    const error = params.get("error");

    if (error) {
      setStatus("error");
      setMessage(decodeURIComponent(error));
      return;
    }

    if (connectedId) {
      setStatus("success");
      setMessage("Tenant connected successfully!");
      setActiveTenantId(connectedId);
      qc.invalidateQueries({ queryKey: ["tenants"] });
      setTimeout(() => navigate("/tenants"), 2000);
      return;
    }

    setStatus("error");
    setMessage("Unexpected response from Microsoft.");
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4">
        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto" />
            <p className="text-text-muted">Completing connection...</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
            <p className="text-text font-semibold text-lg">{message}</p>
            <p className="text-text-muted text-sm">Redirecting to tenants...</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-red-400 mx-auto" />
            <p className="text-text font-semibold text-lg">Connection failed</p>
            <p className="text-text-muted text-sm max-w-sm">{message}</p>
            <button
              onClick={() => navigate("/tenants/connect")}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
