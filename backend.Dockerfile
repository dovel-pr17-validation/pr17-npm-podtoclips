FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server

RUN python3 -m venv /opt/easyedits-backend \
  && /opt/easyedits-backend/bin/pip install --no-cache-dir 'yt-dlp[default]'

ENV PORT=8080
ENV YT_DLP_PATH=/opt/easyedits-backend/bin/yt-dlp
ENV YT_DLP_JS_RUNTIME=node
ENV FFMPEG_PATH=ffmpeg

CMD ["npm", "run", "server"]
