FROM node:24-slim

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./

COPY src ./src
COPY next.config.mjs .
COPY tsconfig.json .
COPY public ./public

# Start Next.js in development mode
CMD npm run dev
