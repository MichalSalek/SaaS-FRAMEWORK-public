FROM node:24-slim

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl netcat-openbsd

ADD package.json ./
ADD package-lock.json ./
RUN npm ci

ADD next.config.mjs ./
ADD .next/static ./.next/static
ADD .next/standalone ./.next/standalone

RUN mkdir -p src/prisma src/prisma-app-logs
ADD src/prisma ./src/prisma
ADD src/prisma-app-logs ./src/prisma-app-logs
ADD prisma.config.mjs .
ADD docker-entrypoint.sh .

RUN chmod +x docker-entrypoint.sh

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "run", "start:standalone:noenv"]
