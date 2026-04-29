export interface JobProgressPayload {
  jobId: string;
  packageId: string;
  percent: number;
  logLine: string;
  timestamp: string;
}

export interface JobCompletePayload {
  jobId: string;
  packageId: string;
  intuneWinPath: string;
  fileSize: number;
}

export interface JobFailedPayload {
  jobId: string;
  packageId: string;
  error: string;
}

export interface RadarScanProgressPayload {
  tenantId: string;
  scanned: number;
  total: number;
  currentApp: string;
}

export interface DeploymentProgressPayload {
  jobId: string;
  waveId: string;
  status: string;
  message: string;
  percent: number;
}
