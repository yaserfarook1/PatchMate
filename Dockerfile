FROM node:22-slim

RUN apt-get update && apt-get install -y openssl wine64 && rm -rf /var/lib/apt/lists/*
ENV WINEDEBUG=-all

WORKDIR /app

RUN npm install -g pnpm@10.33.2 tsx

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @autopack/web build
RUN cd packages/database && pnpm db:generate

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["tsx", "apps/api/src/index.ts"]
