FROM node:22-bookworm-slim

WORKDIR /workspace

RUN npm install --global pnpm@10.15.0

COPY package.json pnpm-workspace.yaml tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY tests ./tests
COPY docs ./docs
COPY infra ./infra

RUN pnpm install --no-frozen-lockfile

ENV NODE_ENV=development
