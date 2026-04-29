import React, { createContext, useContext, useState, ReactNode } from "react";

interface TenantContextValue {
  activeTenantId: string | null;
  setActiveTenantId: (id: string) => void;
}

const TenantContext = createContext<TenantContextValue>({
  activeTenantId: null,
  setActiveTenantId: () => {},
});

export function TenantProvider({ children }: { children: ReactNode }) {
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(
    localStorage.getItem("autopack_active_tenant") ?? "tenant_prod_seed"
  );

  function setActiveTenantId(id: string) {
    localStorage.setItem("autopack_active_tenant", id);
    setActiveTenantIdState(id);
  }

  return (
    <TenantContext.Provider value={{ activeTenantId, setActiveTenantId }}>
      {children}
    </TenantContext.Provider>
  );
}

export const useTenant = () => useContext(TenantContext);
