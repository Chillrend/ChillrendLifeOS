FROM node:20-slim

# Install build tools for compiling better-sqlite3 and dependencies for Chromium/Puppeteer
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

# Copying source is handled by volume mount in docker-compose, 
# but good to have for production builds later
COPY . .

# Ensure Puppeteer downloads Chromium explicitly during the Docker build
RUN npx puppeteer browsers clear && npx puppeteer browsers install chrome

EXPOSE 3000

CMD ["npm", "run", "dev"]
