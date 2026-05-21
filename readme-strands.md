# AWS Strands Agents Implementation

## Overview

This project uses the [AWS Strands Agents SDK](https://strandsagents.com/) (`@strands-agents/sdk`) to power the TBS Chat Agent. Strands replaces the need for a custom agentic loop by providing a model-first agent framework that handles tool orchestration, reasoning, and response generation automatically.

## How Strands Removes the Agentic Loop

Traditional agentic implementations require manually coding a loop that:
1. Sends the user message to the LLM
2. Checks if the LLM wants to call a tool
3. Executes the tool and feeds results back to the LLM
4. Repeats until the LLM produces a final response
5. Handles edge cases (max iterations, tool errors, retries)

**With Strands, this entire loop is eliminated.** The SDK's `Agent` class encapsulates the reasoning cycle internally:

```typescript
// No loop needed — Strands handles multi-turn tool use autonomously
const result = await this.agent.invoke(userMessage);
```

The agent autonomously:
- Decides which tools to call (and in what order)
- Executes tools and incorporates results
- Chains multiple tool calls when needed
- Produces a final natural language response

## Architecture

```
User Message
    │
    ▼
Agent.invoke() / Agent.stream()
    │
    ├── Strands Agent Loop (internal) ──┐
    │       │                           │
    │       ▼                           │
    │   Bedrock Model (Claude/Nova)     │
    │       │                           │
    │       ▼                           │
    │   Tool Selection (automatic)      │
    │       │                           │
    │       ▼                           │
    │   Tool Execution                  │
    │   ├── lookup_inventory            │
    │   ├── get_computer_reviews        │
    │   └── get_book_info               │
    │       │                           │
    │       └───────────────────────────┘
    │
    ▼
Final Response
```

## Implementation Details

### Agent Configuration (`src/domain/services/chat-service.ts`)

The agent is configured once at construction time with:
- **Model**: Bedrock model (configurable via environment variable)
- **Tools**: Declarative tool definitions using `tool()` with Zod schemas
- **System Prompt**: Injected via environment variable

### Tool Definitions

Tools are defined declaratively with typed schemas — Strands handles argument parsing, validation, and error handling:

```typescript
const lookupInventory = tool({
  name: 'lookup_inventory',
  description: 'Search The Better Store product catalog...',
  inputSchema: z.object({
    productName: z.string().optional(),
    category: z.enum(['BOOKS', 'COMPUTERS', 'MOBILE']).optional(),
  }),
  callback: async (input) => ({ products: await this.inventoryService.lookupInventory(...) }),
});
```

### Streaming

Strands provides native streaming via `agent.stream()`, emitting events as the model generates content:

```typescript
for await (const event of this.agent.stream(message)) {
  if (event.type === 'modelStreamUpdateEvent') {
    await onChunk(event.event.delta.text);
  }
}
```

## Benefits Over a Custom Agentic Loop

| Concern | Custom Loop | Strands |
|---------|-------------|---------|
| Tool orchestration | Manual iteration logic | Automatic |
| Multi-step reasoning | Custom state management | Built-in |
| Tool error handling | Manual try/catch per iteration | SDK-managed |
| Streaming | Custom event parsing | Native `stream()` API |
| Model switching | Rewrite loop per provider | Swap `BedrockModel` config |
| Observability | Manual span creation | Auto-generated traces for AgentCore |
| Conversation history | Manual message array management | `agent.messages` property |

## Deployment on AgentCore Runtime

The Strands agent runs inside a container on AgentCore Runtime. The runtime provides:
- Serverless scaling with per-session isolation (microVMs)
- Automatic CloudWatch log group creation
- Tracing/spans for Online Evaluations (when enabled)
- Consumption-based pricing

The HTTP server (`src/application/runtime-server/index.ts`) exposes the agent via AgentCore's HTTP protocol, receiving requests and delegating to `ChatService.query()` or `ChatService.queryStream()`.

## Advantages Over Other Frameworks on AgentCore

Strands is built by AWS and designed as the native SDK for AgentCore. Compared to LangGraph, CrewAI, or custom implementations:

| Capability | Strands | LangGraph / CrewAI |
|------------|---------|-------------------|
| AgentCore Memory integration | First-class `AgentCoreMemorySessionManager` — plug in and go | Manual API calls or community adapters |
| AgentCore built-in tools (Code Interpreter, Browser) | Native tool definitions, no glue code | Requires custom wrapper implementations |
| Tracing & Online Evaluations | Auto-generated spans compatible with AgentCore's `aws/spans` log group | Manual OpenTelemetry instrumentation needed |
| Long-running tasks | Built-in `add_async_task` / `complete_async_task` integration | Custom session keep-alive logic |
| Credential propagation | Runtime role flows through automatically | Manual credential wiring |
| MCP protocol support | Native — agents can expose/consume MCP tools directly on AgentCore | Adapter layer required |
| Multi-agent patterns | Built-in Swarm, Graph, and Workflow coordination | Framework-specific (LangGraph graphs, CrewAI crews) |
| Model flexibility | Swap between Claude, Nova, or any Bedrock model via config | Typically requires code changes |
| Maintenance & compatibility | Same team ships Strands and AgentCore — integration points stay in sync | Community-maintained, may lag behind AgentCore API changes |

### Key Takeaway

Using Strands on AgentCore means less boilerplate for memory, tracing, and tool integration. Features like Online Evaluations and Transaction Search work out of the box because Strands produces the span format AgentCore expects — no manual instrumentation required.
