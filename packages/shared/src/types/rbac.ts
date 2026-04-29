export type UserRole = "Admin" | "Member";

export const PERMISSIONS = {
  TENANT_MANAGE: ["Admin"],
  PACKAGE_BUILD: ["Admin", "Member"],
  PACKAGE_VIEW: ["Admin", "Member"],
  DEPLOYMENT_TRIGGER: ["Admin", "Member"],
  SETTINGS_EDIT: ["Admin"],
  AUDIT_VIEW: ["Admin"],
  FLOW_MANAGE: ["Admin", "Member"],
  ACCESS_MANAGE: ["Admin"],
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
