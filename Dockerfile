FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production GONG_DATA_DIR=/data
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir /data && chown node /data
VOLUME /data
USER node
EXPOSE 8787
CMD ["node", "dist/cli.js"]
