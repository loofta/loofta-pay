FROM node:20-alpine AS builder

WORKDIR /app

COPY apps/twitter-bot/package.json ./
RUN npm install

COPY apps/twitter-bot .

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
