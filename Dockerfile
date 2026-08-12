FROM node:20-alpine AS base
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY admin-ui/package.json admin-ui/package-lock.json ./admin-ui/
RUN npm --prefix admin-ui ci
COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm run build:client

FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/admin-ui/dist ./admin-ui/dist
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/package.json ./package.json
EXPOSE 8080
CMD ["node", "dist/server.js"]
