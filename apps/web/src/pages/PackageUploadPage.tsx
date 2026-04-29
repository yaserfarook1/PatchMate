import React, { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Upload, File } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useTenant } from "../contexts/TenantContext";
import { useTenants } from "../hooks/useTenants";

export function PackageUploadPage() {
  const navigate = useNavigate();
  const { activeTenantId, setActiveTenantId } = useTenant();
  const { data: tenants } = useTenants();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ appName: "", publisher: "", version: "", installCmd: "", uninstallCmd: "" });
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    setFile(f);
    const baseName = f.name.replace(/\.(exe|msi|msix|zip|appx)$/i, "").replace(/[_-]/g, " ").replace(/setup|installer/gi, "").trim();
    if (!form.appName) setForm((p) => ({ ...p, appName: baseName }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !form.appName || !form.version || !activeTenantId) {
      toast.error("Please fill all required fields");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("appName", form.appName);
      fd.append("publisher", form.publisher || "Unknown");
      fd.append("version", form.version);
      fd.append("tenantId", activeTenantId);
      if (form.installCmd) fd.append("installCmd", form.installCmd);
      if (form.uninstallCmd) fd.append("uninstallCmd", form.uninstallCmd);

      const { data } = await api.post("/packages/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("App uploaded and build queued!");
      navigate(`/packages/${data.packageId}`);
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <button
        onClick={() => navigate("/packages")}
        className="flex items-center gap-2 text-text-muted hover:text-text text-sm"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Packages
      </button>

      <div>
        <h1 className="text-2xl font-bold text-text">Upload Custom App</h1>
        <p className="text-text-muted text-sm mt-1">Upload an EXE, MSI, MSIX, or ZIP to package it for Intune.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
            dragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
          }`}
        >
          <input ref={inputRef} type="file" accept=".exe,.msi,.msix,.zip,.appx" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          {file ? (
            <div className="flex flex-col items-center gap-2">
              <File className="w-10 h-10 text-primary" />
              <p className="font-medium text-text">{file.name}</p>
              <p className="text-xs text-text-muted">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="w-10 h-10 text-text-muted" />
              <p className="font-medium text-text">Drop installer file here</p>
              <p className="text-xs text-text-muted">.exe, .msi, .msix, .zip, .appx — up to 500 MB</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {[
            { key: "appName", label: "App Name *", placeholder: "Google Chrome", required: true },
            { key: "publisher", label: "Publisher", placeholder: "Google LLC", required: false },
            { key: "version", label: "Version *", placeholder: "131.0.0", required: true },
          ].map(({ key, label, placeholder, required }) => (
            <div key={key} className={key === "appName" ? "col-span-2" : ""}>
              <label className="block text-sm font-medium text-text-muted mb-1.5">{label}</label>
              <input
                value={(form as any)[key]}
                onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                required={required}
                placeholder={placeholder}
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          ))}
        </div>

        <div>
          <label className="block text-sm font-medium text-text-muted mb-1.5">Tenant</label>
          <select
            value={activeTenantId ?? ""}
            onChange={(e) => setActiveTenantId(e.target.value)}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {tenants?.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1.5">Install Command</label>
            <input value={form.installCmd} onChange={(e) => setForm((p) => ({ ...p, installCmd: e.target.value }))} placeholder="setup.exe /S" className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm font-mono text-text focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1.5">Uninstall Command</label>
            <input value={form.uninstallCmd} onChange={(e) => setForm((p) => ({ ...p, uninstallCmd: e.target.value }))} placeholder="Uninstall.exe /S" className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm font-mono text-text focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
        </div>

        <button
          type="submit"
          disabled={uploading || !file}
          className="w-full flex items-center justify-center gap-2 py-3 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg transition-colors disabled:opacity-60"
        >
          {uploading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><Upload className="w-4 h-4" /> Upload & Build</>}
        </button>
      </form>
    </div>
  );
}
