import axios, { AxiosInstance } from "axios";
import { prisma } from "@autopack/database";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_BETA = "https://graph.microsoft.com/beta";

// ── Token refresh ─────────────────────────────────────────────────────────────

export async function refreshTenantToken(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.refreshToken || !tenant?.intuneClientId) {
    throw new Error("Tenant missing credentials — please reconnect");
  }

  const [azureTenantId, clientId, clientSecret] = [
    tenant.azureTenantId ?? "",
    tenant.intuneClientId,
    tenant.clientSecret ?? "",
  ];

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tenant.refreshToken,
    client_id: clientId,
    scope: "https://graph.microsoft.com/.default offline_access",
  });

  if (clientSecret) {
    params.set("client_secret", clientSecret);
  }

  const { data } = await axios.post(
    `https://login.microsoftonline.com/${azureTenantId || "common"}/oauth2/v2.0/token`,
    params,
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  const expiresAt = new Date(Date.now() + (data.expires_in - 60) * 1000);

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tenant.refreshToken,
      tokenExpiresAt: expiresAt,
    },
  });

  return data.access_token;
}

async function getValidToken(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.accessToken) throw new Error("No access token — reconnect the tenant first");

  const expiresAt = tenant.tokenExpiresAt as Date | null;
  const isExpired = expiresAt && new Date() >= expiresAt;

  if (isExpired) {
    if (!tenant.refreshToken) {
      throw new Error("Access token expired and no refresh token — please reconnect the tenant");
    }
    console.log(`[Token] Access token for tenant ${tenantId} expired — refreshing automatically`);
    try {
      return await refreshTenantToken(tenantId);
    } catch (err: any) {
      throw new Error(`Token refresh failed (${err.message}) — please reconnect the tenant`);
    }
  }

  // Proactively refresh if expiry is within 5 minutes (background, non-blocking)
  const fiveMin = 5 * 60 * 1000;
  if (expiresAt && expiresAt.getTime() - Date.now() < fiveMin && tenant.refreshToken) {
    refreshTenantToken(tenantId).catch((err) =>
      console.warn(`[Token] Proactive refresh failed for ${tenantId}:`, err.message)
    );
  }

  return tenant.accessToken;
}

function graphClient(accessToken: string, beta = false): AxiosInstance {
  return axios.create({
    baseURL: beta ? GRAPH_BETA : GRAPH_BASE,
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 30000,
  });
}

// ── Graph API calls ───────────────────────────────────────────────────────────

export interface GraphDetectedApp {
  id: string;
  displayName: string;
  version: string;
  deviceCount: number;
  platform: string;
  publisher?: string;
}

export async function getDetectedApps(tenantId: string): Promise<GraphDetectedApp[]> {
  const token = await getValidToken(tenantId);
  const client = graphClient(token);

  const results: GraphDetectedApp[] = [];
  let nextLink: string | undefined = `${GRAPH_BASE}/deviceManagement/detectedApps?$top=100&$select=id,displayName,version,deviceCount,platform,publisher`;

  while (nextLink) {
    const url = nextLink.startsWith("http") ? nextLink.replace(GRAPH_BASE, "") : nextLink;
    let resp: { data: { value: GraphDetectedApp[]; "@odata.nextLink"?: string } };
    try {
      resp = await client.get(url) as typeof resp;
    } catch (err: any) {
      const detail = err.response?.data?.error?.message ?? err.message;
      const status = err.response?.status ?? "unknown";
      console.warn(`[Graph] getDetectedApps page failed (HTTP ${status}): ${detail}`);
      // Return whatever we collected so far — partial results are better than nothing
      break;
    }
    results.push(...(resp.data.value ?? []));
    nextLink = resp.data["@odata.nextLink"];
  }

  if (results.length === 0) {
    console.warn("[Graph] getDetectedApps returned 0 results. Check DeviceManagementManagedDevices.Read.All permission.");
  }

  return results;
}

export interface GraphManagedApp {
  id: string;
  displayName: string;
  publisher: string | null;
  description: string | null;
  appVersion: string | null;
  createdDateTime: string;
  lastModifiedDateTime: string;
  isAssigned: boolean;
  displayVersion?: string;
  fileName?: string;
}

// Windows-only OData types we care about
const WINDOWS_APP_TYPES = new Set([
  "#microsoft.graph.win32LobApp",
  "#microsoft.graph.windowsMsiX86App",
  "#microsoft.graph.windowsUniversalAppX",
  "#microsoft.graph.windowsStoreApp",
  "#microsoft.graph.microsoftStoreForBusinessApp",
]);

export async function getManagedApps(tenantId: string): Promise<GraphManagedApp[]> {
  const token = await getValidToken(tenantId);
  const client = graphClient(token, true);

  const results: GraphManagedApp[] = [];
  // No isof() filter — pull all apps and filter client-side.
  // isof() requires specific permissions and is unreliable across tenants.
  let nextLink: string | undefined =
    `/deviceAppManagement/mobileApps?$select=id,displayName,publisher,description,createdDateTime,lastModifiedDateTime,isAssigned&$top=100`;

  while (nextLink) {
    // On subsequent pages, nextLink is already a full URL; strip the base.
    const url: string = nextLink.startsWith("http")
      ? nextLink.replace(GRAPH_BETA, "")
      : nextLink;

    let resp: { data: { value: (GraphManagedApp & { "@odata.type"?: string })[]; "@odata.nextLink"?: string } };
    try {
      resp = await client.get(url) as typeof resp;
    } catch (err: any) {
      const detail = err.response?.data?.error?.message ?? err.message;
      const status = err.response?.status ?? "unknown";
      console.error(`[Graph] getManagedApps failed — HTTP ${status}:`, detail);
      throw new Error(`Graph API error (${status}): ${detail}`);
    }

    const windowsApps = (resp.data.value ?? []).filter(
      (a) => !a["@odata.type"] || WINDOWS_APP_TYPES.has(a["@odata.type"])
    );
    results.push(...windowsApps);
    nextLink = resp.data["@odata.nextLink"];
  }

  return results;
}

export async function getDeviceCount(tenantId: string): Promise<number> {
  const token = await getValidToken(tenantId);
  const client = graphClient(token);

  try {
    const { data } = await client.get("/deviceManagement/managedDevices/$count", {
      headers: { ConsistencyLevel: "eventual" },
    });
    return typeof data === "number" ? data : parseInt(data, 10) || 0;
  } catch {
    // Fallback: get first page and use @odata.count
    const { data } = await client.get("/deviceManagement/managedDevices?$top=1&$count=true", {
      headers: { ConsistencyLevel: "eventual" },
    });
    return data["@odata.count"] ?? 0;
  }
}

export interface GraphGroup {
  id: string;
  displayName: string;
  description: string | null;
  groupTypes: string[];
  membershipRule?: string | null;
}

export async function getGroups(tenantId: string): Promise<GraphGroup[]> {
  const token = await getValidToken(tenantId);
  const client = graphClient(token);

  const results: GraphGroup[] = [];
  let nextLink: string | undefined =
    `${GRAPH_BASE}/groups?$select=id,displayName,description,groupTypes,membershipRule&$top=100`;

  while (nextLink) {
    const { data } = await client.get(nextLink.replace(GRAPH_BASE, "")) as
      { data: { value: GraphGroup[]; "@odata.nextLink"?: string } };
    results.push(...(data.value ?? []));
    nextLink = data["@odata.nextLink"];
    if (results.length >= 500) break;
  }

  return results;
}

export async function getCurrentUser(accessToken: string): Promise<{ id: string; mail: string; displayName: string }> {
  const { data } = await axios.get(`${GRAPH_BASE}/me?$select=id,mail,displayName,userPrincipalName`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return {
    id: data.id,
    mail: data.mail ?? data.userPrincipalName,
    displayName: data.displayName,
  };
}
