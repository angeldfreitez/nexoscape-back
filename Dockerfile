FROM node:24.22.2-bookworm-slim AS development
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --strict-peer-dependencies
COPY tsconfig*.json *.config.ts .prettierrc.json ./
COPY src ./src
COPY scripts ./scripts
COPY test ./test
COPY api ./api
RUN pnpm build
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
