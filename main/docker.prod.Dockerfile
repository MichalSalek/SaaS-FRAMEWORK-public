FROM node:24-slim

WORKDIR /app

# Copy package files
ADD package.json ./
ADD package-lock.json ./
ADD next.config.mjs ./

# Copy standalone build output
ADD .next/standalone ./.next/standalone
ADD .next/static ./.next/standalone/main/.next/static

# Copy public assets
COPY public ./.next/standalone/main/public

# Set port
EXPOSE 3000

# Start the standalone server
ENTRYPOINT ["npm", "run", "start:standalone:noenv"]
