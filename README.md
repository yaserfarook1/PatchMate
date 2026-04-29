# PatchMate

Cloud-native Intune app packaging and patch management platform. Search 12,000+ apps from the Winget catalog, build `.intunewin` packages, deploy to Microsoft Intune with automated deployment waves.

![PatchMate](https://img.shields.io/badge/PatchMate-Intune%20Packaging-facc15?style=flat-square)

## Features

- **Instant Apps** — 12,650+ apps from Winget catalog, searchable with all versions
- **One-click Build & Deploy** — download installer → IntuneWinAppUtil packaging → encrypted upload → Intune assignment
- **Patch Flows** — wave-based deployment (Pilot → UAT → Production) with auto-scheduling
- **Radar** — scan Intune devices for discovered apps, detect outdated versions, blast radius visualization
- **Real Entra ID Auth** — Microsoft OAuth login, role-based access (Admin / Member)
- **PSADT Wrapper** — auto-generated PowerShell App Deployment Toolkit scripts
- **Smart Detection** — binary framework detection (NSIS, InnoSetup, WiX, MSI) + version-aware PS1 detection scripts

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL 16 (Prisma ORM) |
| Queue | BullMQ + Redis |
| Auth | Azure AD / Entra ID (OAuth 2.0 delegated) |
| Realtime | Socket.io |
| Charts | Recharts + D3.js |
| Packaging | Microsoft IntuneWinAppUtil.exe |

## Prerequisites

- **Node.js** 20+
- **pnpm** (`npm install -g pnpm`)
- **Docker Desktop** (for PostgreSQL + Redis)
- **Windows** (IntuneWinAppUtil.exe is Windows-only)

## Quick Start

```bash
# 1. Clone
git clone https://github.com/yaserfarook1/PatchMate.git
cd PatchMate

# 2. Install dependencies
pnpm install

# 3. Create .env file
cp .env.example .env
# Edit .env with your values (see Environment Variables below)

# 4. Start PostgreSQL + Redis
docker compose up -d

# 5. Setup database
cd packages/database
pnpm db:generate
pnpm db:migrate
pnpm db:seed
cd ../..

# 6. Run
pnpm dev
```

- **API**: http://localhost:3001
- **Web**: http://localhost:5173

## Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL=postgresql://autopack:autopack@localhost:5432/autopack
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key-min-32-chars-change-this
PORT=3001
FRONTEND_URL=http://localhost:5173
UPLOADS_DIR=./uploads
MOCK_AUTH=true
NODE_ENV=development

# Optional: GitHub token for higher Winget API rate limits
GITHUB_TOKEN=

# Azure OAuth (set after connecting tenant)
AZURE_OAUTH_REDIRECT_URI=http://localhost:3001/api/tenants/oauth-callback

# Graph API scopes
GRAPH_SCOPES=https://graph.microsoft.com/DeviceManagementApps.ReadWrite.All https://graph.microsoft.com/DeviceManagementManagedDevices.Read.All https://graph.microsoft.com/Group.Read.All https://graph.microsoft.com/User.Read offline_access
```

## Connecting Your Intune Tenant

1. **Azure Portal → App Registrations → New registration**
   - Supported account types: Single tenant
   - Redirect URIs (Web):
     - `http://localhost:3001/api/tenants/oauth-callback`
     - `http://localhost:5173/auth/callback`

2. **API Permissions → Add → Microsoft Graph → Delegated:**
   - `DeviceManagementApps.ReadWrite.All`
   - `DeviceManagementManagedDevices.Read.All`
   - `Group.Read.All`
   - `User.Read.All`
   - `User.Read`
   - Grant admin consent

3. **Certificates & Secrets → New client secret** — copy the value

4. In PatchMate → **Tenants → Connect Tenant** — paste Client ID, Tenant ID, Client Secret

## Project Structure

```
PatchMate/
├── apps/
│   ├── web/          React frontend (Vite, port 5173)
│   └── api/          Express backend (port 3001)
│       └── tools/    IntuneWinAppUtil.exe
├── packages/
│   ├── database/     Prisma schema + migrations
│   └── shared/       Shared TypeScript types
├── docker-compose.yml
└── turbo.json
```

## License

MIT
