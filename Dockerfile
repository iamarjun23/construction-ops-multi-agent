# Single image: builds the React UI, then runs the Express API, which
# serves that build as static files (src/api/server.ts) alongside /api/*.
# Not built or run in the sandbox this repo was authored in — its network
# policy blocks all Docker Hub pulls, so this could not be pulled/tested
# end-to-end there. Every piece that doesn't require an image pull (the
# web build, Express static-serving, and the migrate/seed/ingest sequence
# the entrypoint runs) was verified directly; see docs/demo.md.

FROM node:22-slim AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY eval ./eval
COPY data ./data
COPY tsconfig.json ./
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh
COPY --from=web-build /app/web/dist ./web/dist

ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["./docker/entrypoint.sh"]
