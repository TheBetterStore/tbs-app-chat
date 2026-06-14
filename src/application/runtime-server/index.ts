import 'reflect-metadata';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { BedrockAgentCoreClient, CreateEventCommand } from '@aws-sdk/client-bedrock-agentcore';
import container, { initContainer } from './container';
import { IChatService } from '../../domain/interfaces/chat-service.interface';
import TYPES from '../../infrastructure/types';

const PORT = 8080;
const MEMORY_ID = process.env.MEMORY_ID || '';

let chatService: IChatService;
const containerReady = initContainer();
const memoryClient = new BedrockAgentCoreClient({ region: 'ap-southeast-2' });

function decodeJwtPayload(token: string): Record<string, any> {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString());
}

function getActorId(req: IncomingMessage): string {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return 'anonymous';
  try {
    const claims = decodeJwtPayload(token);
    return claims.sub || claims['cognito:username'] || 'anonymous';
  } catch {
    return 'anonymous';
  }
}

async function init() {
  await containerReady;
  const ssm = new SSMClient();
  const resp = await ssm.send(
    new GetParameterCommand({ Name: process.env.BRAVE_API_KEY_PARAM!, WithDecryption: true }),
  );
  chatService = container.get<IChatService>(TYPES.IChatService);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });
}

async function storeEvent(actorId: string, sessionId: string, role: string, text: string) {
  if (!MEMORY_ID) return;
  try {
    await memoryClient.send(new CreateEventCommand({
      memoryId: MEMORY_ID,
      actorId,
      sessionId,
      eventPayload: { contentBlocks: [{ text }] },
      branch: 'main',
      eventAttributes: { role },
    }));
  } catch (err) {
    console.warn('Failed to store memory event:', err);
  }
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }

  if (req.url === '/invocations' && req.method === 'POST') {
    try {
      const actorId = getActorId(req);
      const body = JSON.parse(await readBody(req));
      const messages = body.messages || [{ role: 'user', content: [{ text: body.prompt }] }];
      const sessionId = req.headers['x-amzn-bedrock-agentcore-runtime-session-id'] as string || 'default';

      // Store user message in memory
      const userText = messages[messages.length - 1]?.content?.[0]?.text || '';
      await storeEvent(actorId, sessionId, 'user', userText);

      // Streaming response
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

      let fullResponse = '';
      await chatService.queryStream(messages, async (text: string) => {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      });

      // Store assistant response in memory
      await storeEvent(actorId, sessionId, 'assistant', fullResponse);

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (err) {
      console.error('Invocation error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
    return;
  }

  res.writeHead(404).end();
});

init().then(() => {
  server.listen(PORT, () => console.log(`AgentCore Runtime server listening on :${PORT}`));
});
