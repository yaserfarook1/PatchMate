# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

AutoPack is a full-stack Intune app packaging and patch-management platform. It lets admins search a Winget catalog, build `.intunewin` packages, deploy to real Microsoft Intune tenants via Graph API, and track updates across managed devices. Think of it as a Robopack clone.

## Essential commands

```bash
# Start everything (API :3001, frontend :5173, Docker must be running)
pnpm dev

# Type-check individual apps without rebuilding
cd apps/api  && pnpm typecheck
cd apps/web  && pnpm typecheck

# Database (run from packages/database, or via root scripts)
pnpm db:generate   # regenerate Prisma client after schema change
pnpm db:migrate    # create + apply a new migration (prompts for name)
pnpm db:seed       # minimal seed: 1 org + 1 admin user only
pnpm db:studio     # open Prisma Studio at localhost:5555

# Infrastructure
docker compose up -d    # start postgres:5432 + redis:6379
docker compose down     # stop containers (data persists in volumes)
```

> **EADDRINUSE on hot-reload?** Run:
> `Get-NetTCPConnection -LocalPort 3001 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`

## Monorepo layout

```
apps/api/       Express 4 + TypeScript — all API, workers, Graph service
apps/web/       React 18 + Vite + Tailwind 3 — all pages and hooks
packages/database/  Prisma schema, migrations, seed, singleton client
packages/shared/    Pure TypeScript types shared between api and web (no runtime deps)
```

Internal packages are referenced as `@autopack/database` and `@autopack/shared` via `workspace:*`. Both are source-imported (not built) — the path aliases in `tsconfig.json` and `vite.config.ts` resolve them directly to their `src/index.ts`.

## Database

Schema is at `packages/database/prisma/schema.prisma`.

Key model relationships:
- `Organisation → Tenant → (Package, PatchFlow, DeviceDiscovery)`
- `App → Package → DeploymentJob`
- `PatchFlow → Wave → DeploymentJob`
- `Package.wingetId` starting with `"Intune."` means the app was synced from Intune; the Graph app ID is everything after the prefix.
- `Package.intuneAppId` is populated after the first deployment to Intune.

After any schema change: `pnpm db:generate` then `pnpm db:migrate`. The generate step must run first because tsx resolves types from the generated client at compile time. On Windows, kill node processes before running generate if you hit `EPERM rename`.

## API architecture

Entry: `apps/api/src/index.ts` — creates `http.Server`, attaches socket.io, starts the BullMQ packaging worker, then listens.

**Route registration** (`src/routes/index.ts`): mounts `/auth`, `/apps`, `/packages`, `/tenants`, `/flows`, `/radar`, `/settings`. Also owns `GET /dashboard/stats` and `GET /audit-logs`.

**Named routes must be declared before `/:id`** in any router file. Express matches top-to-bottom — `GET /oauth-start` must come before `GET /:id` or it will be swallowed as an ID lookup.

**Auth middleware** (`src/middleware/auth.ts`):
- `MOCK_AUTH=true` (default dev): injects a hardcoded admin user; reads `x-mock-role` header to override role.
- Production: verifies JWT from `Authorization: Bearer` header, attaches `req.user`.
- Use `requirePermission("PERMISSION_KEY")` after `requireAuth` for RBAC. Permission keys are defined in `packages/shared/src/types/rbac.ts`.

**Config** (`src/config.ts`): Zod-validated at startup. Crashes immediately if any required env var is missing.

## Real-time (socket.io)

Server: `src/lib/socket.ts` — call `getSocketServer()` from any service.

Room convention:
- `job:${packageId}` — packaging validation progress
- `radar:${tenantId}` — device discovery scan progress
- Global (no room): `deployment:progress` — wave deployment progress

Clients join rooms by emitting `join:job` or `join:radar`. Always respond HTTP immediately (201/200), then run the async work and emit events — never `await` the long operation before responding.

## BullMQ packaging worker

Queue: `src/workers/packagingQueue.ts` — job ID format `pkg-${packageId}`.
Worker: `src/workers/packagingWorker.ts` — concurrency 3, 3 retry attempts with exponential backoff.

The worker emits `job:progress` after each simulated step, then calls `createSimulatedIntuneWin()` (creates a zip stub — not a real installer) and `runValidation()` (90% pass, 10% fail, simulated). Real installer download is not yet implemented.

## Microsoft Graph integration

**`src/services/graphService.ts`** — all Graph API calls. Uses `getValidToken(tenantId)` which checks `tokenExpiresAt` in DB and auto-refreshes (60s buffer). Never call Graph APIs directly from routes; always go through this service.

Scopes (delegated, defined in `.env` `GRAPH_SCOPES`):
`DeviceManagementApps.ReadWrite.All`, `DeviceManagementManagedDevices.Read.All`, `Group.Read.All`, `User.Read`, `offline_access`

**`src/services/intuneDeployService.ts`** — full Win32 LOB deployment flow:
1. If `wingetId` starts with `"Intune."` → skip upload, just assign to group.
2. Otherwise → `createWin32App()`: encrypt file (AES-256-CBC ProfileVersion1), upload to Azure Blob in 4 MB blocks, commit to Intune, poll until `commitFileSuccess`.
3. `assignAppToGroup()` creates a `required` assignment; 409 is treated as success.

Detection method string format stored in DB → `buildDetectionRules()` converts to Graph OData at deploy time:
- `Registry: HKLM\SOFTWARE\...` → `win32LobAppRegistryDetection`
- `File: C:\Program Files\...` → `win32LobAppFileSystemDetection`
- `MSI: {GUID}` → `win32LobAppProductCodeDetection`

## Frontend architecture

Pages are in `apps/web/src/pages/`. Each page has a corresponding hook in `src/hooks/` that wraps React Query.

**API calls**: always via `src/lib/api.ts` (axios instance). Automatically injects the JWT from `localStorage` and the `X-Mock-Role` header.

**Socket.io client**: `src/lib/socket.ts` — `getSocket()` returns a lazily-created singleton. Pages connect to rooms in `useEffect`, clean up with `socket.off` on unmount.

**Active tenant** is stored in `TenantContext` and `localStorage`. All data-fetching hooks that need tenant scope read from `useTenant().activeTenantId`.

**RBAC in UI**: `usePermission("PERMISSION_KEY")` returns a boolean. Use it to conditionally render buttons/actions.

Tailwind 3 is used (not v4). Config is in `apps/web/tailwind.config.js`. Custom colour tokens (background, surface, surface-2, border, primary, text, text-muted, success, warning, error) are defined there and used throughout.

## Environment variables

All declared in the root `.env` (gitignored). The API loads them via `dotenv` in `config.ts`. The database package scripts use `dotenv-cli` (`dotenv -e ../../.env -- prisma ...`).

Key variables:
| Variable | Purpose |
|---|---|
| `MOCK_AUTH` | `true` = bypass Azure login in dev |
| `AZURE_OAUTH_REDIRECT_URI` | Must match exactly in Azure App Registration |
| `GRAPH_SCOPES` | Space-separated delegated scopes for OAuth |
| `UPLOADS_DIR` | Where `.intunewin` files are stored (relative to `apps/api/`) |

## Connecting a real Intune tenant

The user must create an Azure App Registration with:
- Redirect URI: `http://localhost:3001/api/tenants/oauth-callback` (Web platform)
- Delegated permissions (not Application): `DeviceManagementApps.ReadWrite.All`, `DeviceManagementManagedDevices.Read.All`, `Group.Read.All`, `User.Read` — all with admin consent granted.

The OAuth flow stores state in Redis with a 10-minute TTL. The callback at `/api/tenants/oauth-callback` exchanges the code for tokens, saves them to the `Tenant` record, and redirects to `FRONTEND_URL/tenants?connected=<id>`.

## Known limitations / not yet implemented

- `.intunewin` packaging creates a **stub** zip (not a real installer binary). Devices assigned the package via Intune will not actually install anything until real installer download from Winget is implemented.
- Wave delay scheduling (`delayHours` on Wave) is stored but not enforced — all waves can be triggered immediately regardless of delay.
- BullMQ audit logs use the hardcoded seed user ID `"user_admin_seed"` because workers run outside HTTP context.
