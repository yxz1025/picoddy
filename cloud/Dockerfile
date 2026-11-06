FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY resources ./resources
COPY scripts ./scripts
COPY runtime-source ./runtime-source
COPY sandbox ./sandbox
COPY test ./test
COPY web ./web
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/web/dist ./web/dist
COPY src ./src
COPY scripts ./scripts
COPY database ./database
COPY deploy/preflight.mjs ./scripts/deploy-preflight.mjs
COPY deploy/sandbox-smoke.mjs ./scripts/deploy-sandbox-smoke.mjs
COPY resources ./resources
USER node
EXPOSE 8080
CMD ["npm", "start"]
