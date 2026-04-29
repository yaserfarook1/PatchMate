import type { UserRole } from "./rbac.js";
export type { UserRole };
export type AppStatus = "validated" | "pending" | "failed";
export type ValidationStatus = "pending" | "running" | "passed" | "failed";
export type WaveStatus = "pending" | "active" | "completed" | "failed";
export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string | null;
  azureObjectId: string | null;
  createdAt: string;
}

export interface OrganisationDto {
  id: string;
  name: string;
  createdAt: string;
}

export interface TenantDto {
  id: string;
  orgId: string;
  displayName: string;
  intuneClientId: string | null;
  deviceCount: number;
  lastSyncAt: string | null;
  createdAt: string;
}

export interface AppDto {
  id: string;
  wingetId: string;
  name: string;
  publisher: string;
  latestVersion: string;
  category: string;
  iconUrl: string | null;
  description: string | null;
  status: AppStatus;
  createdAt: string;
}

export interface PackageDto {
  id: string;
  appId: string;
  tenantId: string;
  version: string;
  intuneWinPath: string | null;
  detectionMethod: string | null;
  installCmd: string | null;
  uninstallCmd: string | null;
  validationStatus: ValidationStatus;
  validationLog: string | null;
  fileSize: number | null;
  createdAt: string;
  app?: AppDto;
}

export interface WaveDto {
  id: string;
  flowId: string;
  name: string;
  groupId: string;
  delayHours: number;
  order: number;
  status: WaveStatus;
}

export interface PatchFlowDto {
  id: string;
  appId: string;
  tenantId: string;
  name: string;
  autoUpdate: boolean;
  createdAt: string;
  app?: AppDto;
  waves?: WaveDto[];
}

export interface DeploymentJobDto {
  id: string;
  packageId: string;
  waveId: string | null;
  status: JobStatus;
  startedAt: string | null;
  completedAt: string | null;
  errorLog: string | null;
  createdAt: string;
}

export interface DeviceDiscoveryDto {
  id: string;
  tenantId: string;
  appName: string;
  publisher: string;
  installedVersion: string;
  deviceCount: number;
  lastScanned: string;
}

export interface CustomAppSettingDto {
  id: string;
  appId: string;
  tenantId: string;
  installArgs: string | null;
  preScript: string | null;
  postScript: string | null;
  registryValues: Record<string, string> | null;
}

export interface AuditLogDto {
  id: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  timestamp: string;
  details: Record<string, unknown> | null;
  user?: Pick<UserDto, "id" | "name" | "email">;
}
