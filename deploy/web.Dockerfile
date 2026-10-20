# Albok web: the exported Expo web UI, served by Caddy, which also terminates TLS and proxies the API.
# Build context: the repository root.
FROM node:24-alpine AS build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/scripts ./scripts
RUN npm ci
COPY frontend ./
# Same-origin API in production.
ENV EXPO_PUBLIC_API_URL=""
RUN npx expo export --platform web

FROM caddy:2-alpine
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/frontend/dist /srv
