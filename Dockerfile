ARG NODE_IMAGE=node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

FROM ${NODE_IMAGE} AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src

RUN npm run build

FROM ${NODE_IMAGE} AS production-dependencies

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --omit=peer --ignore-scripts \
  && npm pkg delete devDependencies \
  && rm -rf node_modules/prisma node_modules/typescript \
  && npm prune --omit=dev --omit=peer --ignore-scripts \
  && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime

RUN apt-get update \
  && apt-get install --yes --no-install-recommends dumb-init=1.2.5-2 \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

ENV NODE_ENV=production
WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json

USER node

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/main.js"]
