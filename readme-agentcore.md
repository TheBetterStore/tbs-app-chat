# tbs-app-chat

A serverless chat application for The Better Store providing an AI shopping assistant powered by Amazon Bedrock. The solution supports multiple deployment modes: Lambda (REST API + WebSocket) and AWS Bedrock AgentCore (container-based runtime).

## Architecture

- **Runtime**: Node.js 24.x (Lambda + AgentCore container)
- **AI Model**: Claude Sonnet via Amazon Bedrock Converse API
- **APIs**: REST (API Gateway + Cognito), WebSocket (API Gateway V2), AgentCore Runtime (HTTP container)
- **Infrastructure**: SAM/CloudFormation
- **Build**: esbuild

## AWS AgentCore Runtime

The AgentCore deployment runs the chat agent as a long-lived container on AWS Bedrock AgentCore, providing managed scaling and session lifecycle without Lambda cold starts.

### AgentCore Components

| Resource | Purpose |
|---|---|
| `AgentCoreRuntimeRole` | IAM role assumed by `bedrock-agentcore.amazonaws.com` with Bedrock, SSM, KMS, and ECR permissions |
| `ChatAgentRuntime` | AgentCore Runtime definition — references the ECR container image, sets environment variables, and configures networking/lifecycle |
| `ChatAgentEndpoint` | Production inference endpoint exposing the runtime for invocation |

### Container Runtime Server

The container (`src/application/runtime-server/index.ts`) is a lightweight HTTP server that:

- Listens on port 8080
- Exposes `/ping` for health checks
- Exposes `POST /invocations` for inference — accepts a messages array, streams SSE responses via `ChatService.queryStream()`
- Initialises on startup by fetching secrets from SSM Parameter Store

### AgentCore Configuration

```yaml
NetworkConfiguration:
  NetworkMode: PUBLIC
ProtocolConfiguration: HTTP
LifecycleConfiguration:
  IdleRuntimeSessionTimeout: 900   # 15 min idle before sleep
  MaxLifetime: 14400               # 4 hour max session
```

## Implementation Steps — AgentCore Additions

1. **Created the runtime server** (`src/application/runtime-server/index.ts`)
   - HTTP server with `/ping` health check and `POST /invocations` streaming endpoint
   - Initialises `ChatService` with SSM-sourced secrets at startup

2. **Created the Dockerfile**
   - Multi-stage build: installs deps, bundles with esbuild, produces minimal production image
   - Externalises AWS SDK packages (provided by the runtime environment)
   - Exposes port 8080

3. **Created `deploy-container.sh`**
   - Creates ECR repository if needed
   - Authenticates to ECR
   - Builds ARM64 image via `docker buildx`
   - Pushes to ECR

4. **Added CloudFormation resources to `template.yaml`**
   - `AgentCoreRuntimeRole` — IAM role with Bedrock, SSM, KMS, ECR permissions for the AgentCore service principal
   - `ChatAgentRuntime` — Runtime definition referencing the ECR image, environment variables, network/lifecycle config
   - `ChatAgentEndpoint` — Inference endpoint for the runtime
   - Stack outputs for runtime and endpoint ARNs

## Deployment

### Lambda (existing)

```bash
sam build --cached
sam deploy --guided
```

### AgentCore Container

```bash
# Build and push container image to ECR
./deploy-container.sh

# Deploy full stack (includes AgentCore resources)
./deploy.sh
```

> **Note**: On x86_64 hosts, register QEMU binfmt before building ARM64 images:
> ```bash
> docker run --rm --privileged multiarch/qemu-user-static --reset -p yes
> ```

## Environment Variables

| Variable | Description |
|---|---|
| `BEDROCK_MODEL` | Bedrock model ID (e.g. `global.anthropic.claude-sonnet-4-5-20250929-v1:0`) |
| `MAX_TOKENS` | Max tokens for model response |
| `SYSTEM_PROMPT` | System prompt for the assistant |
| `PRODUCTS_API_BASE_URL` | Base URL for the product catalog API |
| `BRAVE_API_KEY_PARAM` | SSM parameter name for Brave Search API key |
| `ALLOWED_CORS_DOMAINS` | Comma-separated allowed CORS origins |

## Development

```bash
npm install
npm run compile
npm run unit
```
