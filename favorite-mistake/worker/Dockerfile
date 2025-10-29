FROM nvidia/cuda:12.3.1-cudnn8-runtime-ubuntu22.04

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y curl build-essential python3 \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y nodejs \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json tsconfig.json ./
COPY proto ./proto
COPY src ./src
RUN npm install
RUN npm run build
RUN npm prune --omit=dev

CMD ["node", "dist/worker.js"]
