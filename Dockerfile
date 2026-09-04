FROM node:20-slim

# Install build tools for compiling better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

# Copying source is handled by volume mount in docker-compose, 
# but good to have for production builds later
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
