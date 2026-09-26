FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server

ENV NODE_ENV=production
EXPOSE 4000
CMD ["npx", "tsx", "apps/server/src/index.ts"]
