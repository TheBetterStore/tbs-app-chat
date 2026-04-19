import { IChatService } from '../interfaces/chat-service.interface';
import { BedrockRuntimeClient, ConverseCommand, Message } from '@aws-sdk/client-bedrock-runtime';
import { inject, injectable } from 'inversify';
import TYPES from '../../infrastructure/types';
import { IInventoryService } from '../interfaces/inventory-service.interface';

const client = new BedrockRuntimeClient({ region: 'ap-southeast-2' });

const tools = [
  {
    toolSpec: {
      name: 'lookup_inventory',
      description:
        'Search The Better Store product catalog. Returns products with name, category, price, description, and details.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            productName: {
              type: 'string',
              description: 'Optional product name to filter by',
            },
            brandId: {
              type: 'string',
              description:
                'Optional brand name to filter by (e.g. ASUS, Dell, Apple, Lenovo, HP, Samsung, Microsoft, Acer, Razer, MSI, Penguin Books, HarperCollins, Bloomsbury)',
            },
            category: {
              type: 'string',
              description: 'Optional product category to filter by',
              enum: ['BOOKS', 'COMPUTERS', 'MOBILE'],
            },
          },
        },
      },
    },
  },
];

@injectable()
export class ChatService implements IChatService {
  constructor(
    @inject(TYPES.IInventoryService) private inventoryService: IInventoryService,
    @inject(TYPES.BedrockModel) private bedrockModel: string,
    @inject(TYPES.MaxTokens) private maxTokens: string,
    @inject(TYPES.SystemPrompt) private systemPrompt: string,
  ) {}

  async query(messages: Message[]): Promise<any> {
    console.info('querying against model: ' + this.bedrockModel, messages);

    const self = this;

    const converse = () =>
      client.send(
        new ConverseCommand({
          modelId: this.bedrockModel,
          messages,
          system: [
            {
              text: self.systemPrompt,
            },
          ],
          toolConfig: { tools },
        }),
      );

    let response = await converse();

    while (response.stopReason === 'tool_use') {
      const assistantMsg = response.output!.message!;
      messages.push(assistantMsg);

      console.debug(JSON.stringify(assistantMsg));
      const toolResults: any[] = [];
      for (const block of assistantMsg.content || []) {
        if (block.toolUse) {
          const input = block.toolUse.input as any;
          const items = await self.inventoryService.lookupInventory(input?.productName, input?.brandId, input?.category);
          toolResults.push({
            toolResult: {
              toolUseId: block.toolUse.toolUseId,
              content: [{ json: { products: items } }],
            },
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
      response = await converse();
    }

    console.info('response', JSON.stringify(response));
    return response;
  }
}
