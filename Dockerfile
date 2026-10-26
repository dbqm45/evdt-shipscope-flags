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
# The Prisma schema comes with the manifests: npm ci's postinstall runs `prisma generate`.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
# src/flags/shared is committed and CI checks it is in sync with the frontend, so build it as is
# (`npm run build` would first run sync:shared, which needs the frontend sources).
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
# --ignore-scripts: the postinstall `prisma generate` needs the dev-only CLI; the client is already compiled into dist.
# --omit=optional: @prisma/client lists the CLI as an optional peer, which would otherwise pull it (and Prisma Studio,
# ~250 MB) into the runtime image.
RUN npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=api-build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/api" || exit 1
CMD ["node", "dist/main.js"]

# --- Dashboard -------------------------------------------------------------------------------------------------

FROM ${NODE_IMAGE} AS web-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend ./
RUN npm run build

FROM ${NGINX_IMAGE} AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
