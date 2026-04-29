export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiSuccess<T = unknown> {
  data: T;
  message?: string;
}

export interface DashboardStats {
  totalPackages: number;
  activeTenantsCount: number;
  runningJobs: number;
  deploymentsThisWeek: number;
  appsNeedingUpdate: number;
  packagesByStatus: { status: string; count: number }[];
}
