FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY bot.js ./

ENV NODE_ENV=production
ENV TANJIRO_DATA_DIR=/data

EXPOSE 3000
VOLUME ["/data"]

CMD ["npm", "start"]