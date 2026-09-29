FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
WORKDIR /app
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
COPY client ./client
COPY START-HERE.md ./
COPY docs/INTEGRATOR.md docs/OPERATOR.md docs/OPERATIONS.md ./docs/
COPY deploy ./deploy
RUN pnpm build
ENV HOST=0.0.0.0 DELIVERY_DATA=/data
EXPOSE 3100
CMD ["node", "build/src/server.js"]
