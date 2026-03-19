FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

ENV NODE_ENV=production
ENV PORT=5000

USER node

EXPOSE 5000

CMD ["node", "backend/server.js"]
