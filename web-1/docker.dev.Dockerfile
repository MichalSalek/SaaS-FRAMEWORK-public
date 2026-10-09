FROM node:24-slim

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl netcat-openbsd

COPY package.json ./
COPY package-lock.json ./

COPY src ./src
COPY next.config.mjs .
COPY tsconfig.json .
COPY prisma.config.mjs .
COPY docker-entrypoint.sh .

RUN chmod +x docker-entrypoint.sh

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "run", "dev"]
