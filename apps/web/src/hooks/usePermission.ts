import { PERMISSIONS, PermissionKey } from "@autopack/shared";
import { useAuth } from "../contexts/AuthContext";

export function usePermission(permission: PermissionKey): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return (PERMISSIONS[permission] as readonly string[]).includes(user.role);
}
