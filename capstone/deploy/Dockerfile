FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8080 CAPSTONE_DB_PATH=/data/workspace.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY --from=build /app/build ./build
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/capstone ./capstone
COPY --from=build /app/scripts ./scripts
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:8080/api/capstone/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server/capstoneServer.ts"]
