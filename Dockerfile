FROM node:24-bookworm-slim

ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --chown=node:node src ./src
RUN mkdir -p /app/.wwebjs_auth /app/.wwebjs_cache \
  && chown node:node /app/.wwebjs_auth /app/.wwebjs_cache

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

USER node

EXPOSE 3000

CMD ["node", "src/index.js"]
