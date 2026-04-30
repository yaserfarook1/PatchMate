FROM mcr.microsoft.com/windows/servercore:ltsc2022

# Install Node.js
ADD https://nodejs.org/dist/v22.12.0/node-v22.12.0-win-x64.zip C:\\node.zip
RUN powershell -Command "Expand-Archive C:\\node.zip -DestinationPath C:\\ ; Rename-Item C:\\node-v22.12.0-win-x64 C:\\nodejs ; Remove-Item C:\\node.zip"
RUN setx PATH "%PATH%;C:\nodejs"

# Install pnpm
RUN C:\nodejs\npm install -g pnpm@10.33.2

WORKDIR C:\\app

# Copy package files first (better caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build frontend
RUN pnpm --filter @autopack/web build

# Generate Prisma client
RUN cd packages/database && pnpm db:generate

EXPOSE 3001

CMD ["C:\\nodejs\\node.exe", "node_modules\\.bin\\tsx", "apps/api/src/index.ts"]
