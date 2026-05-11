import 'reflect-metadata';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { ChatService } from '../../domain/services/chat-service';
import { InventoryService } from '../../domain/services/inventory-service';

const PORT = 8080;

let chatService: ChatService;

async function init() {
  const ssm = new SSMClient();
  const resp = await ssm.send(
    new GetParameterCommand({ Name: process.env.BRAVE_API_KEY_PARAM!, WithDecryption: true }),
  );
  const inventoryService = new InventoryService();
  chatService = new ChatService(
    inventoryService,
    process.env.BEDROCK_MODEL || '',
    process.env.MAX_TOKENS || '1024',
    process.env.SYSTEM_PROMPT || '',
    resp.Parameter?.Value || '',
  );
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }

  if (req.url === '/invocations' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const messages = body.messages || [{ role: 'user', content: [{ text: body.prompt }] }];

      // Streaming response
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

      await chatService.queryStream(messages, async (text: string) => {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      });

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
