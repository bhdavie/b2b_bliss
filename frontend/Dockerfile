# Dev-mode Dockerfile. Compose mounts ./frontend so changes hot-reload.
# For production we'll add a multi-stage build later (Vercel handles prod, so optional).

FROM node:22-alpine
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]
