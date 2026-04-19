# tbs-app-chat

A serverless chat API for The Better Store that provides an AI shopping assistant powered by Amazon Bedrock. Users can ask about products and the assistant retrieves real-time inventory data via tool use.

## Architecture

- **Runtime**: Node.js 24.x Lambda (SAM/CloudFormation)
- **AI Model**: Claude Sonnet via Amazon Bedrock Converse API
- **API**: API Gateway (REST) with Cognito user pool authorizer
- **DI**: Inversify for dependency injection
- **Build**: esbuild (via SAM metadata)

## How the RAG Process Works

This application uses Bedrock's **tool use** (function calling) pattern rather than traditional vector-based RAG. The flow is:

1. **User sends a message** — The client POSTs a conversation history (messages array) to `POST /chat/v1/query`.

2. **Bedrock Converse call** — `ChatService` sends the messages to the configured Bedrock model along with a system prompt and a `lookup_inventory` tool definition. The tool schema accepts optional `productName` and `brandId` parameters.

3. **Tool use loop** — If Bedrock's response has `stopReason: 'tool_use'`, the assistant wants to look up product data:
   - The assistant message (containing `toolUse` blocks) is appended to the conversation.
   - For each `toolUse` block, `InventoryService.lookupInventory()` is called with the extracted `productName` and/or `brandId`.
   - `lookupInventory()` fetches all products from the Product API (`GET {PRODUCTS_API_BASE_URL}/products`) and filters client-side by brand and/or name.
   - Tool results are appended to the conversation as a user message with `toolResult` content blocks.
   - Bedrock is called again with the updated conversation. This loop repeats until the model responds with a natural language answer (no more tool calls).

4. **Final response** — Once Bedrock returns a non-tool-use response, it is returned to the client.

```
Client → API Gateway → Lambda (ChatService)
                            ↓
                      Bedrock Converse (Claude)
                            ↓ (tool_use)
                      InventoryService.lookupInventory()
                            ↓
                      Product API (GET /products)
                            ↓ (filtered results)
                      Bedrock Converse (with tool results)
                            ↓
                      Final answer → Client
```

## Environment Variables

| Variable | Description |
|---|---|
| `BEDROCK_MODEL` | Bedrock model ID (e.g. `apac.anthropic.claude-sonnet-4-5-20250514-v1:0`) |
| `MAX_TOKENS` | Max tokens for model response |
| `SYSTEM_PROMPT` | System prompt for the model |
| `PRODUCTS_API_BASE_URL` | Base URL for the product catalog API |
| `ALLOWED_CORS_DOMAINS` | Comma-separated allowed CORS origins |

## Deployment

```bash
# Build and deploy
sam build --cached
sam deploy --guided
```

Or use the provided scripts:
- `deploy.sh` — deploys using a configurable S3 bucket
- `deploy-local.sh` — deploys with hardcoded local settings

## Development

```bash
npm install
npm run compile   # TypeScript compilation
npm run unit      # Run tests
npm run test      # Compile + test
```
