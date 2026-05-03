import { IChatService } from '../interfaces/chat-service.interface';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  Message,
  ContentBlock,
  Tool,
} from '@aws-sdk/client-bedrock-runtime';
import { inject, injectable } from 'inversify';
import TYPES from '../../infrastructure/types';
import { IInventoryService } from '../interfaces/inventory-service.interface';

const client = new BedrockRuntimeClient({ region: 'ap-southeast-2' });
const TOOL_TIMEOUT_MS = 5000;

const tools: Tool[] = [
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
  {
    toolSpec: {
      name: 'get_computer_reviews',
      description:
        'Search for reviews and opinions about a specific computer or laptop. Use when the user asks about reviews for a computer product.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Computer or laptop name/model to search reviews for',
            },
          },
          required: ['query'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_book_info',
      description:
        'Search for book information including ratings and reviews from Open Libary. Use when the user asks about a book.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Book title or author to search for',
            },
          },
          required: ['query'],
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
    @inject(TYPES.BraveApiKey) private braveApiKey: string,
  ) {}

  private get converseParams() {
    return {
      modelId: this.bedrockModel,
      system: [{ text: this.systemPrompt }],
      toolConfig: { tools },
    };
  }

  async query(messages: Message[]): Promise<any> {
    console.info('querying against model: ' + this.bedrockModel, messages);

    const converse = () =>
      client.send(new ConverseCommand({ ...this.converseParams, messages }));

    let response = await converse();

    while (response.stopReason === 'tool_use') {
      const assistantMsg = response.output!.message!;
      messages.push(assistantMsg);
      console.debug(JSON.stringify(assistantMsg));

      const toolResults = await this.executeToolCalls(assistantMsg.content || []);
      messages.push({ role: 'user', content: toolResults });
      response = await converse();
    }

    console.info('response', JSON.stringify(response));
    return response;
  }

  async queryStream(messages: Message[], onChunk: (text: string) => Promise<void> | void): Promise<void> {
    console.info('streaming query against model: ' + this.bedrockModel);

    const converseStream = () =>
      client.send(new ConverseStreamCommand({ ...this.converseParams, messages }));

    let continueLoop = true;

    while (continueLoop) {
      const response = await converseStream();
      const stream = response.stream!;

      let stopReason: string | undefined;
      const toolUseBlocks: ContentBlock[] = [];
      let currentToolUse: { toolUseId: string; name: string; jsonBuf: string } | null = null;

      for await (const event of stream) {
        if (event.contentBlockDelta?.delta?.text) {
          await onChunk(event.contentBlockDelta.delta.text);
        }

        if (event.contentBlockStart?.start?.toolUse) {
          const tu = event.contentBlockStart.start.toolUse;
          currentToolUse = { toolUseId: tu.toolUseId!, name: tu.name!, jsonBuf: '' };
        }

        if (event.contentBlockDelta?.delta?.toolUse) {
          if (currentToolUse) {
            currentToolUse.jsonBuf += event.contentBlockDelta.delta.toolUse.input || '';
          }
        }

        if (event.contentBlockStop && currentToolUse) {
          toolUseBlocks.push({
            toolUse: {
              toolUseId: currentToolUse.toolUseId,
              name: currentToolUse.name,
              input: JSON.parse(currentToolUse.jsonBuf || '{}'),
            },
          });
          currentToolUse = null;
        }

        if (event.messageStop) {
          stopReason = event.messageStop.stopReason;
        }
      }

      if (stopReason === 'tool_use' && toolUseBlocks.length > 0) {
        messages.push({ role: 'assistant', content: toolUseBlocks });
        const toolResults = await this.executeToolCalls(toolUseBlocks);
        messages.push({ role: 'user', content: toolResults });
      } else {
        continueLoop = false;
      }
    }
  }

  private async executeToolCalls(contentBlocks: ContentBlock[]) {
    return Promise.all(
      contentBlocks
        .filter((block) => block.toolUse)
        .map(async (block) => {
          const input = block.toolUse!.input as any;
          let result: any;

          if (block.toolUse!.name === 'get_book_info') {
            result = await this.getBookInfo(input.query);
          } else if (block.toolUse!.name === 'get_computer_reviews') {
            result = await this.getComputerReviews(input.query);
          } else {
            result = {
              products: await this.inventoryService.lookupInventory(
                input?.productName,
                input?.brandId,
                input?.category,
              ),
            };
          }

          return {
            toolResult: {
              toolUseId: block.toolUse!.toolUseId,
              content: [{ json: result }],
            },
          };
        }),
    );
  }

  async getComputerReviews(query: string) {
    try {
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query + ' review')}&count=5`,
        {
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': this.braveApiKey,
          },
          signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        return { error: `Review service unavailable (HTTP ${res.status}). Unable to fetch reviews at this time.` };
      }
      const data = await res.json();
      return { results: (data.web?.results || []).map((result: any) => ({
        title: result.title,
        url: result.url,
        description: result.description,
      })) };
    } catch (err) {
      console.error('getComputerReviews failed:', err);
      return { error: 'Review search timed out or failed. Please try again.' };
    }
  }

  async getBookInfo(query: string) {
    try {
      const res = await fetch(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(
          query,
        )}&limit=3&fields=title,author_name,first_publish_year,ratings_average,ratings_count,subject`,
        { signal: AbortSignal.timeout(TOOL_TIMEOUT_MS) },
      );
      const data = await res.json();
      return { results: data.docs.map((doc: any) => ({
        title: doc.title,
        authors: doc.author_name,
        year: doc.first_publish_year,
        avgRating: doc.ratings_average,
        ratingsCount: doc.ratings_count,
        subjects: doc.subject?.slice(0, 5),
      })) };
    } catch (err) {
      console.error('getBookInfo failed:', err);
      return { error: 'Book search timed out or failed. Please try again.' };
    }
  }
}
