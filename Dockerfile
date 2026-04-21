FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY lib ./lib
COPY scripts ./scripts
COPY server.js ./

EXPOSE 3000

CMD ["npm", "start"]
