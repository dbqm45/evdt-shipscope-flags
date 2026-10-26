# syntax=docker/dockerfile:1
# Two images from one file (docker-compose.yml builds both):
#   docker build --target api -t shipscope-flags-api .   # NestJS API on port 3000
#   docker build --target web -t shipscope-flags-web .   # dashboard on nginx, port 80, proxies /api to the API

ARG NODE_IMAGE=node:24-alpine
ARG NGINX_IMAGE=nginx:1.29-alpine

# --- API -------------------------------------------------------------------------------------------------------

FROM ${NODE_IMAGE} AS api-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
# src/flags/shared is committed and CI checks it is in sync with the frontend, so build it as is
# (`npm run build` would first run sync:shared, which needs the frontend sources).
RUN npx nest build

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production \
    PORT=3000 \
    FLAGS_DATA_FILE=/app/data/state.json
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=api-build /app/dist ./dist
# The JSON state file lives in a volume; the app runs as the unprivileged "node" user.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
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
