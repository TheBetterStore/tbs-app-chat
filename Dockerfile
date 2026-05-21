FROM public.ecr.aws/docker/library/node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm install --legacy-peer-deps
COPY src/ src/
COPY tsconfig.json ./
RUN npx esbuild@0.21.0 src/application/runtime-server/index.ts \
  --bundle --platform=node --target=es2020 --outfile=dist/server.js \
  --packages=external

FROM public.ecr.aws/docker/library/node:24-slim
WORKDIR /app
COPY --from=builder /app/dist/server.js ./server.js
COPY --from=builder /app/node_modules/ ./node_modules/
EXPOSE 8080
CMD ["node", "--require", "@aws/aws-distro-opentelemetry-node-autoinstrumentation/register", "server.js"]
