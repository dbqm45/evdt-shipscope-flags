# syntax=docker/dockerfile:1
# Three images from one file (docker-compose.yml builds them all):
#   docker build --target api -t shipscope-flags-api .   # NestJS API on port 3000 (needs DATABASE_URL)
#   docker build --target migrate .                      # one-shot: applies migrations, optionally seeds demo data
#   docker build --target web -t shipscope-flags-web .   # dashboard on nginx, port 80, proxies /api to the API

ARG NODE_IMAGE=node:24-alpine
ARG NGINX_IMAGE=nginx:1.29-alpine

# --- API -------------------------------------------------------------------------------------------------------

FROM ${NODE_IMAGE} AS api-build
WORKDIR /app
# One lockfile for the workspace: npm ci needs every workspace's package.json. The Prisma schema and the shared
# package come with the manifests, because the postinstall runs `prisma generate` and builds @shipscope/shared.
COPY package.json package-lock.json prisma.config.ts ./
COPY frontend/package.json ./frontend/
COPY packages/shared ./packages/shared
COPY prisma ./prisma
RUN npm ci -w packages/shared --include-workspace-root --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npx nest build

# Applies the migrations (Prisma CLI is a dev dependency, so this stage keeps them), then loads the demo data into an
# empty database when SEED_DEMO_DATA=true.
FROM api-build AS migrate
CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"$SEED_DEMO_DATA\" = true ]; then node dist/db/load-state.js --seed --if-empty; fi"]

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY packages/shared/package.json ./packages/shared/
# --ignore-scripts: the postinstall (`prisma generate`, building @shipscope/shared) needs dev-only tools; the client
# is already compiled into dist and the shared package's build is copied below.
# --omit=optional: @prisma/client lists the CLI as an optional peer, which would otherwise pull it (and Prisma Studio,
# ~250 MB) into the runtime image.
RUN npm ci -w packages/shared --include-workspace-root --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=api-build /app/packages/shared/dist ./packages/shared/dist
COPY --from=api-build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "dist/main.js"]

# --- Dashboard -------------------------------------------------------------------------------------------------

FROM ${NODE_IMAGE} AS web-build
WORKDIR /app
# The dashboard and @shipscope/shared only (the dashboard builds the shared package from its sources); --ignore-scripts
# skips the API's postinstall, which needs Prisma.
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY packages/shared ./packages/shared
RUN npm ci -w frontend -w packages/shared --ignore-scripts --no-audit --no-fund
COPY frontend ./frontend
RUN npm run build -w frontend

FROM ${NGINX_IMAGE} AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=web-build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
