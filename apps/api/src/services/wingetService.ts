import axios from "axios";

const BASE_URL = "https://winget.run/api/v2/packages";

export interface WingetInstaller {
  Architecture: string;
  InstallerType: string;
  InstallerUrl: string;
  InstallerSha256: string;
  Scope?: string;
  ProductCode?: string;
  InstallerSwitches?: {
    Silent?: string;
    SilentWithProgress?: string;
    Custom?: string;
  };
}

export interface WingetPackage {
  Id: string;
  Name: string;
  Publisher: string;
  Latest: {
    Version: string;
    Installers?: WingetInstaller[];
  };
  Description?: string;
  IconUrl?: string;
  Tags?: string[];
}

export async function searchWinget(query: string, take = 20): Promise<WingetPackage[]> {
  try {
    const { data } = await axios.get(BASE_URL, {
      params: { query, take },
      timeout: 8000,
    });
    return data?.Packages ?? [];
  } catch (err) {
    console.warn("Winget API unavailable:", (err as Error).message);
    return [];
  }
}

export async function getWingetPackage(id: string): Promise<WingetPackage | null> {
  try {
    const { data } = await axios.get(`${BASE_URL}/${encodeURIComponent(id)}`, {
      timeout: 8000,
    });
    return data;
  } catch {
    return null;
  }
}
