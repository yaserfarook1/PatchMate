import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CatalogPage } from "./pages/CatalogPage";
import { AppDetailPage } from "./pages/AppDetailPage";
import { PackagesPage } from "./pages/PackagesPage";
import { PackageDetailPage } from "./pages/PackageDetailPage";
import { PackageUploadPage } from "./pages/PackageUploadPage";
import { TenantsPage } from "./pages/TenantsPage";
import { TenantConnectPage } from "./pages/TenantConnectPage";
import { OAuthCallbackPage } from "./pages/OAuthCallbackPage";
import { FlowsPage } from "./pages/FlowsPage";
import { FlowNewPage } from "./pages/FlowNewPage";
import { FlowDetailPage } from "./pages/FlowDetailPage";
import { RadarPage } from "./pages/RadarPage";
import { SettingsPage } from "./pages/SettingsPage";
import { InstantAppsPage } from "./pages/InstantAppsPage";
import { InstantAppDetailPage } from "./pages/InstantAppDetailPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import RiskAnalysisPage from "./pages/RiskAnalysisPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/tenants/oauth-return" element={<OAuthCallbackPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/instant-apps" element={<InstantAppsPage />} />
        <Route path="/instant-apps/:wingetId" element={<InstantAppDetailPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/catalog/:id" element={<AppDetailPage />} />
        <Route path="/packages" element={<PackagesPage />} />
        <Route path="/packages/upload" element={<PackageUploadPage />} />
        <Route path="/packages/:id" element={<PackageDetailPage />} />
        <Route path="/tenants" element={<TenantsPage />} />
        <Route path="/tenants/connect" element={<TenantConnectPage />} />
        <Route path="/flows" element={<FlowsPage />} />
        <Route path="/flows/new" element={<FlowNewPage />} />
        <Route path="/flows/:id" element={<FlowDetailPage />} />
        <Route path="/radar" element={<RadarPage />} />
        <Route path="/risk-analysis" element={<RiskAnalysisPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
