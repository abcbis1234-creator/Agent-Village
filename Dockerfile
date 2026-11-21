FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.mjs ./
COPY lib ./lib
COPY public ./public
COPY bin ./bin
COPY eval ./eval
ENV HOST=0.0.0.0 PORT=3000
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server.mjs"]
