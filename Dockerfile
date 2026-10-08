# Fallback only. The Containers app is built with the Node.js Buildpack (no Dockerfile); this file exists so the
# project also deploys anywhere that expects one. Keep it in sync with package.json "engines".
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
