# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies (use npm install since we're in a monorepo without local lock file)
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# @onsol/tldparser (used for .skr Seeker ID lookups) declares "borsh": "^2.0.0", but npm hoists
# the root borsh@0.7.0 (needed elsewhere) over it instead, breaking tldparser at runtime. And
# rpc-websockets (a transitive dep of @solana/web3.js) ships a broken uuid import that crashes
# RPC subscriptions. In local dev both are fixed by the monorepo root's postinstall hook — this
# build installs apps/backend standalone and never runs that hook, so apply both explicitly here.
RUN npx patch-package && node patches/fix-tldparser-borsh.js

# Build the application
RUN npm run build

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Set environment
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/healthz || exit 1

# Start the application
CMD ["node", "dist/main"]
