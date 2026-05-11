FROM public.ecr.aws/docker/library/node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ src/
COPY tsconfig.json ./
RUN npx esbuild src/application/runtime-server/index.ts \
  --bundle --platform=node --target=es2020 --outfile=dist/server.js \
  --external:@aws-sdk/client-bedrock-runtime \
  --external:@aws-sdk/client-ssm

FROM public.ecr.aws/docker/library/node:24-slim
WORKDIR /app
COPY --from=builder /app/dist/server.js ./server.js
COPY --from=builder /app/node_modules/ ./node_modules/
EXPOSE 8080
CMD ["node", "server.js"]
