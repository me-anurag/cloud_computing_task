FROM node:20-alpine

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY src/ ./src/

EXPOSE 3001

CMD ["node", "src/server.js"]
