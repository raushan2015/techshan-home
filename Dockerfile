FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @techshan/web build \
  && pnpm --filter @techshan/server build

FROM node:24-alpine AS prod-deps

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
# Install only the server's production graph (server + contracts); the web app
# ships as prebuilt static files and needs no runtime node_modules.
RUN pnpm install --frozen-lockfile --prod --filter @techshan/server...

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/apps/server/package.json ./apps/server/package.json
COPY --from=prod-deps --chown=node:node /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=prod-deps --chown=node:node /app/packages/contracts ./packages/contracts
COPY --from=prod-deps --chown=node:node /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build --chown=node:node /app/packages/contracts/src ./packages/contracts/src
COPY --from=build --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
# Pre-create the data directory owned by the runtime user so the named volume
# starts writable; the server stores generated encryption keys and caches here.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
