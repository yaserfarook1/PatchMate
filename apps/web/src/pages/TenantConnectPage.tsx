import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ExternalLink, ShieldCheck, Info } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";

export function TenantConnectPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    azureTenantId: "",
    clientId: "",
    clientSecret: "",
    displayName: "",
  });
  const [step, setStep] = useState<1 | 2>(1);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!form.azureTenantId || !form.clientId || !form.displayName) return;

    try {
      const { data } = await api.post("/tenants/oauth-start", {
        azureTenantId: form.azureTenantId,
        clientId: form.clientId,
        clientSecret: form.clientSecret || undefined,
        displayName: form.displayName,
      });
      window.location.href = data.authUrl;
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? "Failed to start OAuth");
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <button onClick={() => navigate("/tenants")} className="flex items-center gap-2 text-text-muted hover:text-text text-sm">
        <ArrowLeft className="w-4 h-4" />
        Back to Tenants
      </button>

      <div>
        <h1 className="text-2xl font-bold text-text">Connect Intune Tenant</h1>
        <p className="text-text-muted text-sm mt-1">
          Authenticate with your Microsoft Entra ID to access real Intune data.
        </p>
      </div>

      {/* Step tabs */}
      <div className="flex gap-1 bg-surface-2 p-1 rounded-xl">
        {[{ n: 1, label: "Azure Setup" }, { n: 2, label: "Connect" }].map(({ n, label }) => (
          <button
            key={n}
            onClick={() => setStep(n as 1 | 2)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              step === n ? "bg-surface text-text shadow" : "text-text-muted hover:text-text"
            }`}
          >
            {n}. {label}
          </button>
        ))}
      </div>

      {step === 1 && (
        <div className="bg-surface border border-border rounded-xl p-6 space-y-5">
          <h2 className="font-semibold text-text flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Create an Azure App Registration
          </h2>

          <ol className="space-y-4 text-sm text-text-muted">
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">1</span>
              <div>
                <p className="text-text font-medium">Open Azure Portal → App Registrations</p>
                <a
                  href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80 text-xs flex items-center gap-1 mt-1"
                >
                  portal.azure.com → App Registrations <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">2</span>
              <div>
                <p className="text-text font-medium">Click "New registration"</p>
                <p className="text-xs mt-0.5">Name it anything (e.g. "AutoPack"). Supported account types: <strong>Single tenant</strong>.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">3</span>
              <div>
                <p className="text-text font-medium">Add a Redirect URI</p>
                <p className="text-xs mt-0.5">Platform: <strong>Web</strong>. URI:</p>
                <code className="block mt-1 bg-black text-green-400 text-xs px-3 py-2 rounded-lg font-mono">
                  http://localhost:3001/api/tenants/oauth-callback
                </code>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">4</span>
              <div>
                <p className="text-text font-medium">API Permissions → Add a permission → Microsoft Graph → Delegated</p>
                <p className="text-xs mt-1 mb-2">Add all of these:</p>
                <div className="grid grid-cols-2 gap-1">
                  {[
                    "DeviceManagementApps.ReadWrite.All",
                    "DeviceManagementManagedDevices.Read.All",
                    "Group.Read.All",
                    "User.Read",
                  ].map((p) => (
                    <code key={p} className="text-xs bg-surface-2 px-2 py-1 rounded text-blue-400 font-mono">{p}</code>
                  ))}
                </div>
                <p className="text-xs mt-2 text-yellow-400 flex items-center gap-1">
                  <Info className="w-3 h-3" /> Click "Grant admin consent" after adding permissions.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">5</span>
              <div>
                <p className="text-text font-medium">Certificates & Secrets → New client secret</p>
                <p className="text-xs mt-0.5">Copy the secret <strong>value</strong> (shown only once) and your <strong>Application (client) ID</strong> + <strong>Directory (tenant) ID</strong> from the Overview page.</p>
              </div>
            </li>
          </ol>

          <button
            onClick={() => setStep(2)}
            className="w-full py-3 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg transition-colors"
          >
            I've done this → Next
          </button>
        </div>
      )}

      {step === 2 && (
        <form onSubmit={handleConnect} className="bg-surface border border-border rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-text">Enter your App Registration details</h2>

          {[
            { key: "displayName", label: "Tenant display name *", placeholder: "e.g. Contoso Production", type: "text", required: true },
            { key: "azureTenantId", label: "Directory (Tenant) ID *", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", type: "text", required: true },
            { key: "clientId", label: "Application (Client) ID *", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", type: "text", required: true },
            { key: "clientSecret", label: "Client secret value (recommended)", placeholder: "Paste your secret value here", type: "password", required: false },
          ].map(({ key, label, placeholder, type, required }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-text-muted mb-1.5">{label}</label>
              <input
                type={type}
                required={required}
                value={(form as any)[key]}
                onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm font-mono text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              />
            </div>
          ))}

          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-xs text-blue-300">
            You will be redirected to Microsoft to sign in with your Entra account and grant consent. AutoPack stores the tokens to make Graph API calls on your behalf.
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex-1 px-4 py-2.5 border border-border text-text-muted hover:text-text rounded-lg text-sm transition-colors"
            >
              Back
            </button>
            <button
              type="submit"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <ShieldCheck className="w-4 h-4" />
              Connect with Microsoft
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
