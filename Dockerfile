FROM node:20-slim

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

# Copying source is handled by volume mount in docker-compose, 
# but good to have for production builds later
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
